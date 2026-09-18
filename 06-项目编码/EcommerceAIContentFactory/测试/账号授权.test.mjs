import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createAuthorizationApp } from '../授权服务/应用.mjs';
import { verifyLease } from '../授权服务/协议.mjs';
import { checkPassword } from '../授权服务/密码与签名.mjs';
import { startAuthorizationServer } from '../授权服务/启动.mjs';

const password = 'Local-Authorization-Test-2026!';

/** 测试设备仅使用现场生成的密钥和模拟硬件摘要，不读取任何已有密钥。 */
function device(machineId = 'a'.repeat(64), keys = generateKeyPairSync('ed25519')) {
  const der = keys.publicKey.export({ type: 'spki', format: 'der' });
  return { machineId, devicePublicKey: der.toString('base64url'),
    deviceId: createHash('sha256').update(der).digest('base64url'),
    sign: (input) => sign(null, Buffer.from(input), keys.privateKey).toString('base64url'), keys };
}

/** 每个测试创建独立临时数据库和随机本机端口，完成后关闭和清理。 */
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'account-auth-'));
  const keys = generateKeyPairSync('ed25519');
  let time = Date.now();
  const services = [];
  const servers = [];
  t.after(async () => {
    for (const server of servers) await new Promise((done) => server.close(done));
    for (const service of services) service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const config = { databasePath: join(directory, '账号.sqlite'), signingKey: keys.privateKey,
    issuer: 'http://127.0.0.1:4319', mode: 'demo', now: () => time,
    rateLimit: { ip: 1000, account: 500, windowMs: 60000 }, ...options };
  async function instance() {
    const authority = createAuthorizationApp(config);
    services.push(authority);
    const server = createServer(authority.app);
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    servers.push(server);
    const url = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, body, headers = {}) => {
      const response = await fetch(url + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    return { ...authority, request, url };
  }
  const first = await instance();
  await first.store.createAccount('tester', password);
  const proof = async (identity, purpose = 'login', service = first, username = 'tester') => {
    const result = await service.request('/v1/challenges', { username, machineId: identity.machineId,
      devicePublicKey: identity.devicePublicKey, purpose });
    assert.equal(result.status, 201);
    return { challengeId: result.body.challengeId, signature: identity.sign(result.body.signingInput) };
  };
  const login = async (identity, service = first, secret = password) => service.request('/v1/login',
    { username: 'tester', password: secret, ...await proof(identity, 'login', service) });
  const refresh = async (identity, lease, service = first) => service.request('/v1/leases/refresh',
    { lease, ...await proof(identity, 'refresh', service) });
  return { ...first, keys, config, directory, instance, proof, login, refresh,
    now: () => time, advance: (delta) => { time += delta; },
    verify: (lease, identity, extra = {}) => verifyLease(lease, {
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), issuer: config.issuer,
      deviceId: identity.deviceId, machineId: identity.machineId, now: time, ...extra,
    }) };
}

test('双设备拒绝；相同硬件换公钥和相同公钥换硬件均被拒绝', async (t) => {
  const f = await fixture(t); const a = device();
  const first = await f.login(a); assert.equal(first.status, 200);
  const claims = f.verify(first.body.lease, a);
  assert.equal(claims.account, 'tester'); assert.equal(claims.machineId, a.machineId);
  assert.equal(claims.expiresAt - claims.iat * 1000, 300000);
  for (const b of [device('b'.repeat(64)), device(a.machineId), device('c'.repeat(64), a.keys)]) {
    const result = await f.login(b);
    assert.equal(result.status, 409); assert.equal(result.body.error.code, 'DEVICE_ALREADY_BOUND');
    assert.equal((await f.refresh(b, first.body.lease)).status, 409);
  }
});

test('同机续期和365天后无密码恢复；普通验签不允许过期', async (t) => {
  const f = await fixture(t); const a = device(); const initial = await f.login(a);
  f.advance(150000);
  const fresh = await f.refresh(a, initial.body.lease); assert.equal(fresh.status, 200);
  assert.notEqual(fresh.body.lease, initial.body.lease);
  f.advance(365 * 86400000);
  assert.throws(() => f.verify(initial.body.lease, a), { code: 'LEASE_EXPIRED' });
  assert.equal(f.verify(initial.body.lease, a, { allowExpired: true }).username, 'tester');
  const recovered = await f.refresh(a, initial.body.lease);
  assert.equal(recovered.status, 200); assert.ok(f.verify(recovered.body.lease, a).expiresAt > f.now());
});

test('错误密码和不存在账号使用统一错误；失败不绑定设备且挑战已消费', async (t) => {
  const f = await fixture(t); const a = device(); const proof = await f.proof(a);
  const input = { username: 'tester', password: 'Wrong-Password-2026', ...proof };
  const bad = await f.request('/v1/login', input);
  assert.equal(bad.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal((await f.request('/v1/login', { ...input, password })).body.error.code, 'CHALLENGE_INVALID');
  assert.equal(f.store.db.prepare('SELECT device_id FROM accounts').get().device_id, null);
  const absent = await f.request('/v1/login', { username: 'absent', password, ...await f.proof(a, 'login', f, 'absent') });
  assert.deepEqual(absent.body, bad.body);
  assert.equal((await f.login(device('b'.repeat(64)))).status, 200);
});

test('挑战过期、重复提交、错误用途、错误设备签名均拒绝', async (t) => {
  const f = await fixture(t); const a = device(); const old = await f.proof(a);
  f.advance(60000);
  const input = { username: 'tester', password, ...old };
  assert.equal((await f.request('/v1/login', input)).body.error.code, 'CHALLENGE_EXPIRED');
  assert.equal((await f.request('/v1/login', input)).body.error.code, 'CHALLENGE_INVALID');
  const wrong = { username: 'tester', password, ...await f.proof(a), signature: device().sign('wrong') };
  assert.equal((await f.request('/v1/login', wrong)).body.error.code, 'DEVICE_PROOF_INVALID');
  const mismatch = { username: 'tester', password, ...await f.proof(a, 'refresh') };
  assert.equal((await f.request('/v1/login', mismatch)).body.error.code, 'CHALLENGE_INVALID');
  const valid = { username: 'tester', password, ...await f.proof(a) };
  assert.equal((await f.request('/v1/login', valid)).status, 200);
  assert.equal((await f.request('/v1/login', valid)).body.error.code, 'CHALLENGE_INVALID');
});

test('吊销立即阻止续期；管理员指定公钥和硬件换机；旧版本永久失效', async (t) => {
  const f = await fixture(t); const a = device(); const b = device('b'.repeat(64));
  const initial = await f.login(a);
  const pending = await f.proof(a, 'refresh');
  f.store.revokeAccount('tester');
  assert.equal((await f.request('/v1/leases/refresh', { lease: initial.body.lease, ...pending })).body.error.code, 'CHALLENGE_INVALID');
  assert.equal((await f.refresh(a, initial.body.lease)).body.error.code, 'ACCOUNT_REVOKED');
  assert.equal((await f.login(a)).body.error.code, 'ACCOUNT_REVOKED');
  f.store.rebindAccount('tester', b.devicePublicKey, b.machineId);
  assert.equal((await f.login(a)).status, 409);
  assert.equal((await f.refresh(a, initial.body.lease)).body.error.code, 'ACCOUNT_REVOKED');
  assert.equal((await f.login(b)).status, 200);
  f.store.rebindAccount('tester', a.devicePublicKey, a.machineId);
  assert.equal((await f.refresh(a, initial.body.lease)).body.error.code, 'ACCOUNT_REVOKED');
});

test('两个独立SQLite连接并发首次登录只有一个设备成功；挑战跨实例不可重放', async (t) => {
  const f = await fixture(t); const second = await f.instance(); const a = device(); const b = device('b'.repeat(64));
  const requests = [await f.proof(a), await f.proof(b, 'login', second)];
  const results = await Promise.all([f.request('/v1/login', { username: 'tester', password, ...requests[0] }),
    second.request('/v1/login', { username: 'tester', password, ...requests[1] })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await second.request('/v1/login', { username: 'tester', password, ...requests[0] })).body.error.code, 'CHALLENGE_INVALID');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE device_id IS NOT NULL').get().count, 1);
});

test('刷新挑战也只使用一次；复制lease而无正确设备私钥不能续期', async (t) => {
  const f = await fixture(t); const a = device(); const initial = await f.login(a);
  const proof = await f.proof(a, 'refresh');
  const input = { lease: initial.body.lease, ...proof };
  assert.equal((await f.request('/v1/leases/refresh', input)).status, 200);
  assert.equal((await f.request('/v1/leases/refresh', input)).body.error.code, 'CHALLENGE_INVALID');
  const forged = { lease: initial.body.lease, ...await f.proof(a, 'refresh'), signature: device().sign('copied') };
  assert.equal((await f.request('/v1/leases/refresh', forged)).body.error.code, 'DEVICE_PROOF_INVALID');
});

test('固定公钥pin、issuer、硬件、公钥摘要和JWT签名严格校验', async (t) => {
  const f = await fixture(t); const a = device(); const { body } = await f.login(a);
  for (const extra of [{ publicKey: device().keys.publicKey }, { issuer: 'https://other.invalid' },
    { deviceId: device().deviceId }, { machineId: 'b'.repeat(64) }, { kid: 'untrusted' }]) {
    assert.throws(() => f.verify(body.lease, a, extra));
  }
  const parts = body.lease.split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url')), machineId: 'b'.repeat(64) })).toString('base64url');
  assert.throws(() => f.verify(parts.join('.'), a, { allowExpired: true }), { code: 'INVALID_LEASE' });
});

test('严格输入、禁止公开注册和解绑、数据库不存密码或租约正文', async (t) => {
  const f = await fixture(t); const a = device();
  const fields = { username: 'tester', machineId: a.machineId, devicePublicKey: a.devicePublicKey, purpose: 'login' };
  for (const body of [{ ...fields, machineId: 'x'.repeat(64) }, { ...fields, deviceId: a.deviceId },
    { ...fields, devicePublicKey: 'A'.repeat(59) }, { ...fields, username: "'; DROP TABLE accounts;" }]) {
    assert.equal((await f.request('/v1/challenges', body)).status, 400);
  }
  for (const route of ['/v1/register', '/v1/unbind', '/v1/revoke']) assert.equal((await f.request(route, {})).status, 404);
  assert.equal((await f.request('/v1/challenges', fields, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.request('/v1/login', { value: 'x'.repeat(9000) })).status, 413);
  const initial = await f.login(a); assert.equal(initial.status, 200);
  const stored = f.store.db.prepare('SELECT password_hash FROM accounts').get().password_hash;
  assert.ok(stored.startsWith('scrypt$32768$8$1$')); assert.equal(await checkPassword(password, stored), true);
  await f.store.createAccount('tester2', password);
  assert.notEqual(f.store.db.prepare('SELECT password_hash FROM accounts WHERE username = ?').get('tester2').password_hash, stored);
  f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const bytes = await readFile(join(f.directory, '账号.sqlite'));
  assert.equal(bytes.includes(Buffer.from(password)), false); assert.equal(bytes.includes(Buffer.from(initial.body.lease)), false);
});

test('账号限流跨连接共享、窗口到期恢复且返回Retry-After', async (t) => {
  const f = await fixture(t, { rateLimit: { ip: 100, account: 10, challenge: 2, windowMs: 60000 } });
  const second = await f.instance(); const a = device();
  await f.proof(a); await f.proof(a, 'login', second);
  const limited = await f.request('/v1/challenges', { username: 'tester', machineId: a.machineId,
    devicePublicKey: a.devicePublicKey, purpose: 'login' });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  f.advance(60000); await f.proof(a);
});

test('生产拒绝明文和未信任代理伪造HTTPS；精确可信代理可终止TLS', async (t) => {
  const untrusted = await fixture(t, { mode: 'production', issuer: 'https://license.example.test' });
  assert.equal((await untrusted.request('/.well-known/jwks.json')).status, 403);
  assert.equal((await untrusted.request('/.well-known/jwks.json', undefined, { 'X-Forwarded-Proto': 'https' })).status, 403);
  const trusted = await fixture(t, { mode: 'production', issuer: 'https://license.example.test', trustedProxyIps: ['127.0.0.1'] });
  const result = await trusted.request('/.well-known/jwks.json', undefined, { 'X-Forwarded-Proto': 'https' });
  assert.equal(result.status, 200); assert.equal(result.body.keys[0].crv, 'Ed25519');
  assert.equal(result.body.keys[0].d, undefined); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.throws(() => createAuthorizationApp({ ...trusted.config, issuer: 'http://127.0.0.1:4319' }), /HTTPS/);
  assert.throws(() => createAuthorizationApp({ ...trusted.config, trustedProxyIps: ['loopback'] }), /IP/);
});

test('登录限流与刷新独立，六屏连续在线续期不消耗密码额度', async (t) => {
  const f = await fixture(t, { rateLimit: { ip: 240, account: 1, windowMs: 60000 } });
  const a = device(); const initial = await f.login(a); assert.equal(initial.status, 200);
  assert.equal((await f.login(a)).status, 429);
  for (let index = 0; index < 6; index++) assert.equal((await f.refresh(a, initial.body.lease)).status, 200);
});

test('管理员CLI读取换机申请，旧设备与历史租约被阻断；CLI吊销生效', async (t) => {
  const f = await fixture(t); const a = device(); const b = device('b'.repeat(64));
  const initial = await f.login(a);
  const application = join(f.directory, '设备换机申请.json');
  await writeFile(application, JSON.stringify({ version: 1, machineId: b.machineId, devicePublicKey: b.devicePublicKey }));
  const cli = fileURLToPath(new URL('../授权服务/管理员.mjs', import.meta.url));
  const exec = promisify(execFile);
  const changed = await exec(process.execPath, [cli, '换机', f.config.databasePath, 'tester', application], { windowsHide: true });
  assert.match(changed.stdout, /换机完成/); assert.equal(changed.stdout.includes(initial.body.lease), false);
  assert.equal((await f.login(a)).status, 409); assert.equal((await f.login(b)).status, 200);
  assert.equal((await f.refresh(a, initial.body.lease)).body.error.code, 'ACCOUNT_REVOKED');
  await exec(process.execPath, [cli, '吊销', f.config.databasePath, 'tester'], { windowsHide: true });
  assert.equal((await f.login(b)).body.error.code, 'ACCOUNT_REVOKED');
});

test('独立启动入口只在本机监听；HTTPS配置缺失拒绝；占用端口不接管', async (t) => {
  const f = await fixture(t);
  const keyFile = join(f.directory, '临时测试私钥.pem');
  await writeFile(keyFile, f.keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const reserve = createServer();
  await new Promise((done) => reserve.listen(0, '127.0.0.1', done));
  const port = reserve.address().port;
  const env = { AUTH_PORT: String(port), AUTH_SIGNING_KEY_FILE: keyFile,
    AUTH_DATABASE_PATH: join(f.directory, '启动验收.sqlite') };
  await assert.rejects(startAuthorizationServer(env), /HTTPS/);
  await assert.rejects(startAuthorizationServer(env, ['--本机验收']), { code: 'EADDRINUSE' });
  await new Promise((done) => reserve.close(done));
  const running = await startAuthorizationServer(env, ['--本机验收']);
  try {
    assert.equal(running.server.address().address, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/jwks.json`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).keys[0].crv, 'Ed25519');
  } finally {
    await running.stop();
  }
});
