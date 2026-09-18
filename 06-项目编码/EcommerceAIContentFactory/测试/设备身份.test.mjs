import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import childProcess, { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeviceIdentity } from '../服务端/设备身份.mjs';

const filename = '设备身份.dpapi.json';
const deviceHash = createHash('sha256').update('测试设备，不是真实硬件').digest('hex');
const moduleUrl = new URL('../服务端/设备身份.mjs', import.meta.url).href;

/** 测试替身使用认证加密，不能作为 Windows DPAPI 验证证据。 */
function simulation() {
  const key = createHash('sha256').update('仅供单元测试的加密密钥').digest();
  return {
    platform: 'win32',
    fingerprint: async () => createHash('sha256').update('测试设备，不是真实硬件').digest('hex'),
    protect: async bytes => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    unprotect: async bytes => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    },
  };
}

/** 每次测试使用隔离目录，清理仅限本测试创建的路径。 */
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), '设备身份测试-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, ...simulation() };
}

/** 独立进程验证并发与跨工作目录重启，只回传哈希、公钥和签名。 */
function childIdentity({ directory, cwd, native = false, localAppData }) {
  const script = `
    import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
    const simulation = ${simulation.toString()};
    const { createDeviceIdentity } = await import(${JSON.stringify(moduleUrl)});
    let input = ''; for await (const part of process.stdin) input += part;
    const options = JSON.parse(input);
    try {
      const identity = await createDeviceIdentity({ ...(options.native ? {} : simulation()), directory: options.directory });
      process.stdout.write(JSON.stringify({ deviceId: identity.deviceId, publicKey: identity.publicKey,
        signature: identity.sign('跨进程验签').toString('base64') }));
    } catch (error) { process.stderr.write(error.code || 'DEVICE_TEST_FAILED'); process.exitCode = 1; }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: localAppData ? { ...process.env, LOCALAPPDATA: localAppData } : process.env,
    });
    let output = '';
    let errorCode = '';
    const timer = setTimeout(() => child.kill(), 45_000);
    child.on('error', reject);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errorCode += data; });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`子进程身份验证失败：${errorCode || code}`));
      else { try { resolve(JSON.parse(output)); } catch { reject(new Error('子进程返回格式错误')); } }
    });
    child.stdin.end(JSON.stringify({ directory, native }));
  });
}

test('注入模拟：Ed25519 签名、SPKI 公钥、重载与密文落盘', async t => {
  const options = await fixture(t);
  let privateDer;
  const originalProtect = options.protect;
  options.protect = async bytes => {
    privateDer = JSON.parse(bytes.toString()).privateKey;
    return originalProtect(bytes);
  };
  const first = await createDeviceIdentity(options);
  assert.deepEqual(Object.keys(first).sort(), ['deviceId', 'publicKey', 'sign']);
  assert.equal(first.deviceId, deviceHash);
  assert.equal(createPublicKey(first.publicKey).asymmetricKeyType, 'ed25519');
  assert.match(first.publicKey, /^-----BEGIN PUBLIC KEY-----/);
  for (const message of ['', '中文消息', Buffer.from([0, 255, 17]), new Uint8Array([1, 2])]) {
    const signature = first.sign(message);
    assert.equal(signature.length, 64);
    assert.ok(verify(null, message, first.publicKey, signature));
    assert.equal(verify(null, '已篡改', first.publicKey, signature), false);
  }
  const disk = await readFile(path.join(options.directory, filename), 'utf8');
  assert.equal(disk.includes(privateDer), false, '私钥不得以 base64 明文存储');
  assert.equal(disk.includes('PRIVATE KEY'), false);
  assert.equal(disk.includes(deviceHash), false, '设备绑定信息也放在密文内');
  const envelope = JSON.parse(disk);
  assert.equal(envelope.protection, 'DPAPI-CurrentUser');
  assert.equal(Buffer.from(envelope.ciphertext, 'base64').includes(Buffer.from(privateDer, 'base64')), false);
  const second = await createDeviceIdentity({ ...options, protect: () => { throw new Error('不应重新生成'); } });
  assert.equal(second.publicKey, first.publicKey);
  assert.deepEqual(second.sign('相同消息'), first.sign('相同消息'));
  assert.deepEqual(await readdir(options.directory), [filename]);
});

test('注入模拟：24 个并发调用仅初始化一次', async t => {
  const options = await fixture(t);
  let calls = 0;
  const originalProtect = options.protect;
  options.protect = async bytes => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 40));
    return originalProtect(bytes);
  };
  const identities = await Promise.all(Array.from({ length: 24 }, () => createDeviceIdentity(options)));
  assert.equal(calls, 1);
  assert.equal(new Set(identities.map(identity => identity.publicKey)).size, 1);
  assert.deepEqual(await readdir(options.directory), [filename]);
});

test('注入模拟：6 个独立进程从不同项目目录共享默认身份', async t => {
  const { directory } = await fixture(t);
  const projectA = path.join(directory, '项目甲');
  const projectB = path.join(directory, '项目乙');
  await Promise.all([mkdir(projectA), mkdir(projectB)]);
  const identities = await Promise.all(Array.from({ length: 6 }, (_, i) => childIdentity({
    cwd: i % 2 ? projectA : projectB, localAppData: directory,
  })));
  assert.equal(new Set(identities.map(identity => identity.publicKey)).size, 1);
  for (const identity of identities) assert.ok(verify(null, '跨进程验签', identity.publicKey, Buffer.from(identity.signature, 'base64')));
  assert.deepEqual(await readdir(path.join(directory, '电商AI内容工厂', '设备授权')), [filename]);
  assert.deepEqual(await readdir(projectA), []);
  assert.deepEqual(await readdir(projectB), []);
});

test('非 Windows 拒绝；不接受不完整或无效注入配置', async t => {
  const options = await fixture(t);
  for (const platform of ['linux', 'darwin']) {
    await assert.rejects(createDeviceIdentity({ ...options, platform }), { code: 'DEVICE_PLATFORM_UNSUPPORTED' });
  }
  if (process.platform !== 'win32') {
    await assert.rejects(createDeviceIdentity(), { code: 'DEVICE_PLATFORM_UNSUPPORTED' });
    await assert.rejects(createDeviceIdentity({ platform: 'win32' }), { code: 'DEVICE_PLATFORM_UNSUPPORTED' });
  }
  await assert.rejects(createDeviceIdentity({ ...options, directory: '相对目录' }), { code: 'DEVICE_DIRECTORY_INVALID' });
  if (process.platform === 'win32') {
    await assert.rejects(createDeviceIdentity({ ...options, unprotect: undefined }), { code: 'DEVICE_OPTIONS_INVALID' });
  }
  assert.deepEqual(await readdir(options.directory), []);
});

test('指纹缺失、VM 无效值或查询失败时拒绝随机降级且不落盘', async t => {
  const options = await fixture(t);
  for (const fingerprint of [async () => '', async () => '原始硬件标识', async () => '0'.repeat(64), async () => 'f'.repeat(64), async () => { throw new Error('敏感硬件错误'); }]) {
    await assert.rejects(createDeviceIdentity({ ...options, fingerprint }), error => {
      assert.equal(error.code, 'DEVICE_FINGERPRINT_UNAVAILABLE');
      assert.equal(error.message.includes('敏感硬件错误'), false);
      return true;
    });
  }
  assert.deepEqual(await readdir(options.directory), []);
});

test('加密失败、原样明文保护或无效回读均不发布身份且释放锁', async t => {
  const options = await fixture(t);
  for (const protect of [async () => { throw new Error('敏感私钥载荷'); }, async bytes => Buffer.from(bytes), async () => Buffer.alloc(0)]) {
    await assert.rejects(createDeviceIdentity({ ...options, protect }), error => {
      assert.equal(error.code, 'DEVICE_PROTECTION_FAILED');
      assert.equal(error.message.includes('敏感私钥载荷'), false);
      return true;
    });
    assert.deepEqual(await readdir(options.directory), []);
  }
  await assert.rejects(createDeviceIdentity({ ...options, unprotect: async () => Buffer.from('{}') }), { code: 'DEVICE_IDENTITY_UNREADABLE' });
  assert.deepEqual(await readdir(options.directory), []);
  await createDeviceIdentity(options);
});

test('已有密文损坏、解密错误或硬件变化全部 fail closed，原文件保持不变', async t => {
  const options = await fixture(t);
  await createDeviceIdentity(options);
  const file = path.join(options.directory, filename);
  const original = await readFile(file, 'utf8');
  let generation = 0;
  const protect = async () => { generation++; throw new Error('不允许重新生成'); };
  for (const override of [
    { unprotect: async () => { throw new Error('不得输出私钥'); } },
    { fingerprint: async () => createHash('sha256').update('另一设备').digest('hex') },
    { unprotect: async () => Buffer.from(JSON.stringify({ version: 1, deviceId: deviceHash, privateKey: '无效密钥' })) },
  ]) {
    await assert.rejects(createDeviceIdentity({ ...options, protect, ...override }), { code: 'DEVICE_IDENTITY_UNREADABLE' });
    assert.equal(await readFile(file, 'utf8'), original);
  }
  const envelope = JSON.parse(original);
  const tampered = Buffer.from(envelope.ciphertext, 'base64'); tampered[40] ^= 1;
  for (const invalid of ['', '{半截文件', '{}', JSON.stringify({ ...envelope, version: 2 }),
    JSON.stringify({ ...envelope, ciphertext: '!!非法base64!!' }), JSON.stringify({ ...envelope, ciphertext: tampered.toString('base64') })]) {
    await writeFile(file, invalid);
    await assert.rejects(createDeviceIdentity({ ...options, protect }), { code: 'DEVICE_IDENTITY_UNREADABLE' });
    assert.equal(await readFile(file, 'utf8'), invalid);
  }
  assert.equal(generation, 0);
});

test('已有路径不可读取时拒绝生成，初始化锁超时不抢占', async t => {
  const options = await fixture(t);
  const file = path.join(options.directory, filename);
  await mkdir(file);
  await assert.rejects(createDeviceIdentity(options), { code: 'DEVICE_IDENTITY_UNREADABLE' });
  await rm(file, { recursive: true });
  await mkdir(path.join(options.directory, '设备身份.初始化锁'));
  let now = 0;
  t.mock.method(Date, 'now', () => { now += 16_000; return now; });
  await assert.rejects(createDeviceIdentity(options), { code: 'DEVICE_LOCK_TIMEOUT' });
  assert.deepEqual(await readdir(options.directory), ['设备身份.初始化锁']);
});

test('原子发布遇到外部已创建文件时绝不覆盖，临时密文和锁均清理', async t => {
  const options = await fixture(t);
  const file = path.join(options.directory, filename);
  const originalProtect = options.protect;
  options.protect = async bytes => {
    await writeFile(file, '外部已有文件', { flag: 'wx' });
    return originalProtect(bytes);
  };
  await assert.rejects(createDeviceIdentity(options), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), '外部已有文件');
  assert.deepEqual(await readdir(options.directory), [filename]);
});

// 显式启用：$env:DEVICE_IDENTITY_WINDOWS_TEST='1'; node --test 测试/设备身份.test.mjs
test('实际 Windows：无注入硬件指纹 + CurrentUser DPAPI + 跨进程 roundtrip', {
  skip: process.platform !== 'win32' || process.env.DEVICE_IDENTITY_WINDOWS_TEST !== '1'
    ? '需真实 Windows 并显式设置 DEVICE_IDENTITY_WINDOWS_TEST=1；注入测试不是实机验证' : false,
}, async t => {
  const { directory } = await fixture(t);
  const operations = [];
  const originalSpawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    if (executable !== 'powershell.exe') return originalSpawn(executable, args, options);
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
    const child = originalSpawn(executable, args, options);
    const end = child.stdin.end;
    child.stdin.end = function (value, ...rest) {
      const request = JSON.parse(value);
      operations.push(request.operation);
      if (request.payload) assert.ok(!args.join(' ').includes(request.payload), '敏感载荷只能通过 stdin');
      return end.call(this, value, ...rest);
    };
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const pipeIdentity = await createDeviceIdentity({ directory: path.join(directory, '管道验证') });
  assert.ok(verify(null, '管道签名', pipeIdentity.publicKey, pipeIdentity.sign('管道签名')));
  assert.deepEqual(operations, ['fingerprint', 'protect', 'unprotect']);
  const project = path.join(directory, '另一项目');
  await mkdir(project);
  const identities = await Promise.all(Array.from({ length: 3 }, () => childIdentity({ native: true, cwd: project, localAppData: directory })));
  assert.equal(new Set(identities.map(identity => identity.deviceId)).size, 1);
  assert.equal(new Set(identities.map(identity => identity.publicKey)).size, 1);
  for (const identity of identities) {
    assert.match(identity.deviceId, /^[a-f0-9]{64}$/);
    assert.ok(verify(null, '跨进程验签', identity.publicKey, Buffer.from(identity.signature, 'base64')));
  }
  const storage = path.join(directory, '电商AI内容工厂', '设备授权');
  const file = path.join(storage, filename);
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  const encrypted = Buffer.from(envelope.ciphertext, 'base64');
  assert.equal(encrypted.subarray(0, 20).toString('hex'), '01000000d08c9ddf0115d1118c7a00c04fc297eb', '必须为实际 DPAPI blob');
  assert.equal(encrypted.readUInt32LE(40) & 4, 0, '不得设置 CRYPTPROTECT_LOCAL_MACHINE');
  const restarted = await childIdentity({ native: true, cwd: directory, localAppData: directory });
  assert.equal(restarted.publicKey, identities[0].publicKey);
  encrypted[encrypted.length - 1] ^= 1;
  const damaged = JSON.stringify({ ...envelope, ciphertext: encrypted.toString('base64') });
  await writeFile(file, damaged);
  await assert.rejects(childIdentity({ native: true, cwd: directory, localAppData: directory }), /DEVICE_IDENTITY_UNREADABLE/);
  assert.equal(await readFile(file, 'utf8'), damaged);
  assert.deepEqual(await readdir(storage), [filename]);
});
