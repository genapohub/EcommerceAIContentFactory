import { spawn } from 'node:child_process';
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { link, mkdir, open, readFile, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from './错误.mjs';

const IDENTITY_FILE = '设备身份.dpapi.json';
const LIMIT = 64 * 1024;
const HASH = /^[a-f0-9]{64}$/;
// 脚本和命令行均为静态内容；敏感载荷只走匿名管道，不继承输出或保留 stderr。
const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -eq 'fingerprint') {
    function NormalizeGuid($value) {
      $guid = [Guid]::Empty
      if (-not [Guid]::TryParseExact(([string]$value).Trim(), 'D', [ref]$guid)) { throw 'invalid' }
      $normalized = $guid.ToString('D').ToLowerInvariant()
      $compact = $normalized.Replace('-', '')
      if ($compact -match '^(0+|f+)$' -or $normalized -in @(
        '03000200-0400-0500-0006-000700080009', '00020003-0004-0005-0006-000700080009'
      )) { throw 'invalid' }
      return $normalized
    }
    $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
      [Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    try {
      $key = $registry.OpenSubKey('SOFTWARE\Microsoft\Cryptography')
      try { $machine = NormalizeGuid ($key.GetValue('MachineGuid')) } finally { if ($key) { $key.Dispose() } }
    } finally { $registry.Dispose() }
    $products = @(Get-CimInstance -ClassName Win32_ComputerSystemProduct -OperationTimeoutSec 8)
    if ($products.Count -ne 1) { throw 'invalid' }
    $uuid = NormalizeGuid ($products[0].UUID)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $digest = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('device-identity-v1|' + $machine + '|' + $uuid))
      [Console]::Out.Write(([BitConverter]::ToString($digest)).Replace('-', '').ToLowerInvariant())
    } finally { $sha.Dispose() }
  } else {
    Add-Type -AssemblyName System.Security
    $bytes = [Convert]::FromBase64String($request.payload)
    try {
      $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
      if ($request.operation -eq 'protect') {
        $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
      } elseif ($request.operation -eq 'unprotect') {
        $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
      } else { throw 'invalid' }
      [Console]::Out.Write([Convert]::ToBase64String($result))
    } finally {
      if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
      if ($result) { [Array]::Clear($result, 0, $result.Length) }
    }
  }
} catch { exit 1 }
`;

/** 错误不附加底层异常，避免载荷、私钥或硬件原值出现在日志中。 */
function failure(code, message) {
  return new AppError(message, 503, code);
}

/** 仅使用管道传输载荷，限制子进程时间和输出大小。 */
function runPowerShell(operation, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(POWERSHELL, 'utf16le').toString('base64'),
    ], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0;
    let failed = false;
    const abort = () => { failed = true; child.kill(); };
    const timer = setTimeout(abort, 15_000);
    child.on('error', () => { failed = true; });
    child.stdin.on('error', abort);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > LIMIT) abort();
      else chunks.push(chunk);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      if (failed || code !== 0) {
        output.fill(0);
        reject(failure('DEVICE_WINDOWS_FAILED', 'Windows 设备身份操作失败，请检查 PowerShell、CIM 和当前用户 DPAPI 环境。'));
      } else {
        const value = output.toString('utf8').trim();
        output.fill(0);
        resolve(value);
      }
    });
    child.stdin.end(JSON.stringify({ operation, payload: payload?.toString('base64') }));
  });
}

/** 严格解析密文，禁止宽松 base64 解码掩盖文件损坏。 */
function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > LIMIT) throw new Error('invalid');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('invalid');
  return bytes;
}

/** 默认路径属于 Windows 用户，不依赖 cwd 或项目位置。 */
function identityDirectory(directory) {
  if (directory === undefined) {
    if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) {
      throw failure('DEVICE_DIRECTORY_INVALID', '缺少有效的 LOCALAPPDATA，无法确定设备身份共享目录。');
    }
    return path.join(process.env.LOCALAPPDATA, '电商AI内容工厂', '设备授权');
  }
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw failure('DEVICE_DIRECTORY_INVALID', '设备身份 directory 必须是绝对路径。');
  }
  return directory;
}

/** 独占初始化；不按时间抢占旧锁，防止慢进程仍持锁时出现两个写入者。 */
async function acquireLock(directory) {
  const lock = path.join(directory, '设备身份.初始化锁');
  const deadline = Date.now() + 15_000;
  while (true) {
    try { await mkdir(lock); return () => rmdir(lock); }
    catch (error) { if (error.code !== 'EEXIST') throw failure('DEVICE_STORAGE_FAILED', '设备身份初始化锁无法创建。'); }
    if (Date.now() >= deadline) {
      throw failure('DEVICE_LOCK_TIMEOUT', '设备身份初始化锁等待超时；请确认所有初始化进程已退出后检查残留锁，禁止删除身份文件重试。');
    }
    await delay(50);
  }
}

/** 先同步密文临时文件，再用硬链接原子发布；目标存在时绝不覆盖。 */
async function publish(directory, filename, value) {
  const temporary = path.join(directory, `设备身份.${randomUUID()}.临时`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, filename);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** 从加密包恢复签名能力；只在内存短暂持有 PKCS8，拒绝跨设备迁移。 */
async function restore(ciphertext, deviceId, unprotect) {
  let plaintext;
  let der;
  try {
    plaintext = await unprotect(ciphertext);
    if (!Buffer.isBuffer(plaintext) || plaintext.length > LIMIT) throw new Error('invalid');
    const record = JSON.parse(plaintext.toString('utf8'));
    if (record.version !== 1 || record.deviceId !== deviceId) throw new Error('invalid');
    der = decodeBase64(record.privateKey);
    const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('invalid');
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    return Object.freeze({ deviceId, publicKey, sign: message => sign(null, message, privateKey) });
  } catch {
    throw failure('DEVICE_IDENTITY_UNREADABLE', '设备身份解密或校验失败（当前用户、硬件指纹或密文可能已变化）；已拒绝重新生成，请恢复原用户及身份文件。');
  } finally { plaintext?.fill?.(0); der?.fill(0); }
}

/** 只有文件确实不存在才允许首次创建，损坏、权限错误均 fail closed。 */
async function load(filename, deviceId, unprotect) {
  let value;
  try { value = await readFile(filename, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw failure('DEVICE_IDENTITY_UNREADABLE', '已有设备身份无法读取，已拒绝重新生成。');
  }
  try {
    if (value.length > LIMIT) throw new Error('invalid');
    const envelope = JSON.parse(value);
    if (envelope.version !== 1 || envelope.protection !== 'DPAPI-CurrentUser') throw new Error('invalid');
    return await restore(decodeBase64(envelope.ciphertext), deviceId, unprotect);
  } catch {
    throw failure('DEVICE_IDENTITY_UNREADABLE', '已有设备身份解密或校验失败，已拒绝重新生成；请检查当前 Windows 用户、硬件变化及文件完整性。');
  }
}

/**
 * 创建或恢复用户级 Ed25519 设备身份。sign(string|Buffer|TypedArray) 返回 Buffer。
 * protect/unprotect: async (Buffer) => Buffer；fingerprint: async () => SHA-256 小写 hex。
 * 注入仅用于测试，不代表 Windows 安全验证；非 Windows 模拟需 platform: 'win32' 且三项全部注入。
 * VM 必须提供有效 UUID；克隆同时保留 MachineGuid/UUID 的 VM 无法仅靠这两个标识区分。
 * directory 是显式隔离存储的覆盖入口；生产调用省略以共享默认身份。
 */
export async function createDeviceIdentity({ directory, platform = process.platform, protect, unprotect, fingerprint } = {}) {
  if (platform !== 'win32' || (process.platform !== 'win32' && ![protect, unprotect, fingerprint].every(v => typeof v === 'function'))) {
    throw failure('DEVICE_PLATFORM_UNSUPPORTED', '设备身份仅支持 Windows，非 Windows 不提供明文私钥或其它加密降级。');
  }
  if ([protect, unprotect, fingerprint].some(v => v !== undefined && typeof v !== 'function') || Boolean(protect) !== Boolean(unprotect)) {
    throw failure('DEVICE_OPTIONS_INVALID', 'protect/unprotect 必须成对提供函数，fingerprint 必须为函数。');
  }
  protect ??= async bytes => decodeBase64(await runPowerShell('protect', bytes));
  unprotect ??= async bytes => decodeBase64(await runPowerShell('unprotect', bytes));
  fingerprint ??= () => runPowerShell('fingerprint');
  let deviceId;
  try {
    deviceId = await fingerprint();
    if (typeof deviceId !== 'string' || !HASH.test(deviceId) || /^(0+|f+)$/.test(deviceId)) throw new Error('invalid');
  } catch {
    throw failure('DEVICE_FINGERPRINT_UNAVAILABLE', '无法获取有效的 MachineGuid 与设备 UUID 指纹；请检查注册表/CIM 权限及虚拟机标识，禁止退回随机设备 ID。');
  }
  const folder = identityDirectory(directory);
  const filename = path.join(folder, IDENTITY_FILE);
  const existing = await load(filename, deviceId, unprotect);
  if (existing) return existing;
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const release = await acquireLock(folder);
  let plaintext;
  let der;
  try {
    const concurrent = await load(filename, deviceId, unprotect);
    if (concurrent) return concurrent;
    const { privateKey } = generateKeyPairSync('ed25519');
    der = privateKey.export({ format: 'der', type: 'pkcs8' });
    plaintext = Buffer.from(JSON.stringify({ version: 1, deviceId, privateKey: der.toString('base64') }));
    let ciphertext;
    try {
      ciphertext = await protect(plaintext);
      if (!Buffer.isBuffer(ciphertext) || !ciphertext.length || ciphertext.length > LIMIT / 2 || ciphertext.equals(plaintext)) throw new Error('invalid');
    } catch { throw failure('DEVICE_PROTECTION_FAILED', '设备私钥加密失败，未写入身份文件。'); }
    const identity = await restore(ciphertext, deviceId, unprotect);
    if (identity.publicKey !== createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })) {
      throw failure('DEVICE_PROTECTION_FAILED', '设备私钥加密回读校验失败，未写入身份文件。');
    }
    await publish(folder, filename, JSON.stringify({ version: 1, protection: 'DPAPI-CurrentUser', ciphertext: ciphertext.toString('base64') }));
    return identity;
  } finally { plaintext?.fill(0); der?.fill(0); await release(); }
}
