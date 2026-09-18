import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { openAccountStore } from './账号存储.mjs';
import { machineIdSchema, encodedKeySchema } from './密码与签名.mjs';

/** 仅终端交互输入密码，不接受命令行参数或环境变量密码，避免历史记录泄漏。 */
async function readPassword() {
  if (!process.stdin.isTTY) throw new Error('创建账号需要交互式终端输入隐藏密码');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    process.stderr.write('请输入密码（12-128字符，不回显）：');
    const password = await reader.question('');
    process.stderr.write('\n请再次输入密码：');
    const confirmation = await reader.question('');
    if (password !== confirmation) throw new Error('两次密码不一致');
    return password;
  } finally {
    reader.close();
    process.stderr.write('\n');
  }
}

/** 管理员只操作指定独立库；初始化使用排他新目录，不覆盖已有密钥。 */
export async function runAdmin(args = process.argv.slice(2)) {
  const [command, target, username, machineId, publicKeyFile] = args;
  if (command === '初始化' && args.length === 2) {
    const directory = resolve(target);
    await mkdir(directory, { mode: 0o700 });
    const keys = generateKeyPairSync('ed25519');
    await writeFile(join(directory, '签名私钥.pem'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, '签名公钥.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }),
      { flag: 'wx', mode: 0o644 });
    const store = openAccountStore(join(directory, '账号.sqlite'));
    store.close();
    process.stdout.write('初始化完成。请将签名公钥作为客户端固定信任来源，私钥只留在授权中心。\n');
    return;
  }
  const expected = { '创建': [3], '吊销': [3], '换机': [4, 5] };
  if (!expected[command]?.includes(args.length)) {
    throw new Error('用法：初始化 <新目录> | 创建 <数据库> <账号> | 吊销 <数据库> <账号> | 换机 <数据库> <账号> <设备换机申请.json>，或换机 <数据库> <账号> <64hex硬件摘要> <设备公钥base64url文本文件>');
  }
  const password = command === '创建' ? await readPassword() : undefined;
  const store = openAccountStore(resolve(target));
  try {
    if (command === '创建') await store.createAccount(username, password);
    else if (command === '吊销') store.revokeAccount(username);
    else if (args.length === 4) {
      const request = z.strictObject({ version: z.literal(1), machineId: machineIdSchema, devicePublicKey: encodedKeySchema })
        .parse(JSON.parse(await readFile(resolve(machineId), 'utf8')));
      store.rebindAccount(username, request.devicePublicKey, request.machineId);
    } else store.rebindAccount(username, (await readFile(resolve(publicKeyFile), 'utf8')).trim(), machineId);
    process.stdout.write(`账号${command}完成。\n`);
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAdmin().catch(() => {
    process.stderr.write('管理员操作失败。请检查命令、路径、账号、密码规则及设备公钥；未输出敏感参数。\n');
    process.exitCode = 1;
  });
}
