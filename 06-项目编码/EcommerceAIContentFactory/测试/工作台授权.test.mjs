import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAuthorizationApp } from '../授权服务/应用.mjs';
import { createLicenseClient } from '../服务端/账号授权.mjs';
import { createApplication } from '../服务端/应用.mjs';

function device(char) {
  const keys = generateKeyPairSync('ed25519');
  return { deviceId: char.repeat(64), publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    sign: message => sign(null, Buffer.from(message), keys.privateKey) };
}
async function listen(app) {
  const server = createServer(app); server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'factory-license-'));
  const clock = { value: Date.now() }; const now = () => clock.value;
  const keys = generateKeyPairSync('ed25519'); const authorityHost = await listen();
  const authority = createAuthorizationApp({ databasePath: path.join(directory, '授权.sqlite'), signingKey: keys.privateKey,
    issuer: authorityHost.url, mode: 'demo', now, rateLimit: { ip: 1000, account: 500, windowMs: 60000 } });
  authorityHost.server.on('request', authority.app);
  const pin = path.join(directory, '公钥.pem'); await writeFile(pin, keys.publicKey.export({ type: 'spki', format: 'pem' }));
  const env = { FACTORY_LICENSE_URL: authorityHost.url, FACTORY_LICENSE_PUBLIC_KEY_FILE: pin };
  const password = 'LocalTestPassword123!'; await authority.store.createAccount('tester', password);
  const cleanup = [];
  t.after(async () => { for (const close of cleanup) await close(); await new Promise(resolve => authorityHost.server.close(resolve)); authority.close(); await rm(directory, { recursive: true, force: true }); });
  const client = (name, identity, options = {}) => createLicenseClient({ directory: path.join(directory, name), env, now, identityFactory: async () => identity, ...options });
  return { directory, authority, env, password, now, clock, client, cleanup };
}

test('工作台默认拒绝未授权业务，模型配置和授权状态仍可访问', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'factory-gate-'));
  const app = createApplication({ dataDir: directory, env: {}, startJobs: false }); const host = await listen(app.app);
  t.after(async () => { await new Promise(r => host.server.close(r)); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const { token } = await (await fetch(host.url + '/api/v1/session')).json(); const headers = { 'X-Factory-Token': token };
  for (const route of ['/projects', '/jobs', '/assets/unknown']) {
    const response = await fetch(host.url + '/api/v1' + route, { headers });
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'LICENSE_REQUIRED');
  }
  assert.equal((await fetch(host.url + '/api/v1/config', { headers })).status, 200);
  const status = await (await fetch(host.url + '/api/v1/license', { headers })).json();
  assert.equal(status.configured, false); assert.equal(status.authorized, false);
  assert.equal((await fetch(host.url + '/api/v1/license')).status, 401);
});

test('真实HTTP授权中心：同机激活续期，第二设备拒绝，状态不泄露密码和租约', async t => {
  const f = await fixture(t); const a = f.client('甲', device('a')); const b = f.client('乙', device('b'));
  assert.equal((await a.activate({ account: 'tester', password: f.password })).authorized, true);
  await assert.rejects(b.activate({ account: 'tester', password: f.password }), error => error.code === 'DEVICE_ALREADY_BOUND');
  assert.equal((await a.refresh()).authorized, true);
  const publicStatus = JSON.stringify(await a.status());
  assert.equal(publicStatus.includes(f.password), false); assert.equal(publicStatus.includes('eyJ'), false);
  const saved = await readFile(path.join(f.directory, '甲', '设备租约.json'), 'utf8');
  assert.equal(saved.includes(f.password), false); assert.equal(saved.includes('PRIVATE KEY'), false);
});

test('同机重启与过期租约在线恢复，复制记录到其他设备失败', async t => {
  const f = await fixture(t); const identity = device('a'); const a = f.client('甲', identity);
  await a.activate({ account: 'tester', password: f.password }); f.clock.value += 10 * 60 * 1000;
  const restarted = f.client('甲', identity);
  assert.equal((await restarted.status()).authorized, true);
  await mkdir(path.join(f.directory, '复制'));
  await copyFile(path.join(f.directory, '甲', '设备租约.json'), path.join(f.directory, '复制', '设备租约.json'));
  const copied = f.client('复制', device('b'));
  assert.equal((await copied.status()).authorized, false);
  await assert.rejects(copied.requireActive(), error => error.code === 'LICENSE_REQUIRED');
});

test('授权中心断网时新生成被拒绝，管理员吊销后无法续期', async t => {
  const f = await fixture(t); let offline = false;
  const client = f.client('甲', device('a'), { request: (...args) => offline ? Promise.reject(new Error('network')) : fetch(...args) });
  await client.activate({ account: 'tester', password: f.password });
  offline = true; await assert.rejects(client.requireActive({ online: true }), error => error.code === 'LICENSE_OFFLINE');
  offline = false; f.authority.store.revokeAccount('tester');
  await assert.rejects(client.requireActive({ online: true }), error => error.code === 'ACCOUNT_REVOKED');
  assert.equal((await client.status()).authorized, false);
});

test('退出清理登录记录但不解除服务器绑定，伪造本地租约不能授权', async t => {
  const f = await fixture(t); const a = f.client('甲', device('a')); await a.activate({ account: 'tester', password: f.password });
  const file = path.join(f.directory, '甲', '设备租约.json'); const saved = JSON.parse(await readFile(file, 'utf8'));
  await a.logout(); assert.equal((await a.status()).authorized, false);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await assert.rejects(f.client('乙', device('b')).activate({ account: 'tester', password: f.password }), error => error.code === 'DEVICE_ALREADY_BOUND');
  saved.lease = saved.lease.slice(0, -8) + 'tampered'; await writeFile(file, JSON.stringify(saved));
  assert.equal((await f.client('甲', device('a')).status()).authorized, false);
});

test('工作台新增任务前在线校验，即使租约未过期也不能使用已吊销账号', async t => {
  const f = await fixture(t); const license = f.client('甲', device('a')); await license.activate({ account: 'tester', password: f.password });
  const app = createApplication({ dataDir: path.join(f.directory, '业务'), env: {}, license, startJobs: false }); const host = await listen(app.app);
  f.cleanup.push(async () => { await new Promise(r => host.server.close(r)); await app.close(); });
  const { token } = await (await fetch(host.url + '/api/v1/session')).json(); const headers = { 'X-Factory-Token': token, 'Content-Type': 'application/json' };
  assert.equal((await fetch(host.url + '/api/v1/projects', { headers })).status, 200);
  f.authority.store.revokeAccount('tester');
  const response = await fetch(host.url + '/api/v1/jobs', { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 403); assert.equal(app.store.list('jobs').length, 0);
});
