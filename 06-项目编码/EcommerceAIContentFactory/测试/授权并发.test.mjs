import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { createLicenseClient } from '../服务端/账号授权.mjs';

const credentials = account => ({ account, password: 'ConcurrencyTestPassword123!' });

/** 显式超时将队列死锁变为失败，屏障不依赖机器执行速度。 */
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('授权操作在 2 秒内未完成，可能存在队列死锁')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

/** 磁盘和请求均为内存替身；租约签名及客户端验签使用真实 Ed25519。 */
function fixture(t) {
  const authority = generateKeyPairSync('ed25519');
  const device = generateKeyPairSync('ed25519');
  const issuer = 'https://license.invalid';
  const directory = path.resolve('授权并发内存目录');
  const pin = path.join(directory, '公钥.pem');
  const filename = path.join(directory, '设备租约.json');
  const publicKey = device.publicKey.export({ format: 'pem', type: 'spki' });
  const deviceDer = device.publicKey.export({ format: 'der', type: 'spki' });
  const digest = bytes => createHash('sha256').update(bytes).digest('base64url');
  const kid = digest(authority.publicKey.export({ format: 'der', type: 'spki' }));
  const machineId = 'a'.repeat(64);
  const files = new Map([[pin, authority.publicKey.export({ format: 'pem', type: 'spki' })]]);
  const challenges = new Map();
  const operations = [];
  const barriers = [];
  const f = { files, filename, calls: [], clock: 1_800_000_000_000, respond: undefined, beforeRename: undefined };
  const missing = () => Object.assign(new Error('内存文件不存在'), { code: 'ENOENT' });
  t.mock.method(fs, 'readFile', async name => {
    if (!files.has(name)) throw missing();
    return files.get(name);
  });
  t.mock.method(fs, 'mkdir', async () => {});
  t.mock.method(fs, 'writeFile', async (name, value, options) => {
    if (options?.flag === 'wx' && files.has(name)) throw Object.assign(new Error('文件已存在'), { code: 'EEXIST' });
    files.set(name, value);
  });
  t.mock.method(fs, 'unlink', async name => { if (!files.delete(name)) throw missing(); });
  t.mock.method(fs, 'rename', async (from, to) => {
    await f.beforeRename?.();
    if (!files.has(from)) throw missing();
    files.set(to, files.get(from)); files.delete(from);
  });
  syncBuiltinESMExports();

  function issue(username) {
    const iat = Math.floor(f.clock / 1000);
    const claims = { iss: issuer, aud: 'ecommerce-ai-content-factory', sub: randomUUID(),
      username, account: username, deviceId: digest(deviceDer), machineId,
      ver: 1, jti: randomBytes(24).toString('base64url'), iat, nbf: iat, exp: iat + 300,
      expiresAt: (iat + 300) * 1000, refreshAfter: (iat + 60) * 1000 };
    const input = [{ alg: 'EdDSA', typ: 'JWT', kid }, claims]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${input}.${sign(null, Buffer.from(input), authority.privateKey).toString('base64url')}`;
  }
  async function request(url, options) {
    const route = url.pathname;
    const body = JSON.parse(options.body);
    f.calls.push({ route, username: body.username, purpose: body.purpose });
    const response = await f.respond?.(route, body, options);
    if (response) return response;
    if (route === '/v1/challenges') {
      assert.equal(body.machineId, machineId);
      assert.equal(body.devicePublicKey, deviceDer.toString('base64url'));
      const challengeId = randomBytes(24).toString('base64url');
      const signingInput = JSON.stringify({ ...body, challengeId });
      challenges.set(challengeId, { ...body, signingInput });
      return Response.json({ challengeId, signingInput });
    }
    assert.ok(['/v1/login', '/v1/leases/refresh'].includes(route), '不得调用模拟范围外的接口');
    const challenge = challenges.get(body.challengeId);
    assert.ok(challenge, '必须使用一次性挑战'); challenges.delete(body.challengeId);
    assert.equal(challenge.purpose, route === '/v1/login' ? 'login' : 'refresh');
    assert.equal(verify(null, Buffer.from(challenge.signingInput), device.publicKey,
      Buffer.from(body.signature, 'base64url')), true);
    if (route === '/v1/login') assert.equal(body.username, challenge.username);
    return Response.json({ lease: issue(challenge.username) });
  }
  f.barrier = () => {
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    const barrier = { entered, release, pause: async () => { enter(); await released; } };
    barriers.push(barrier); return barrier;
  };
  f.makeClient = () => {
    const client = createLicenseClient({ directory, env: { FACTORY_LICENSE_URL: issuer, FACTORY_LICENSE_PUBLIC_KEY_FILE: pin },
      now: () => f.clock, request, identityFactory: async () => ({ deviceId: machineId, publicKey,
        sign: input => sign(null, Buffer.from(input), device.privateKey) }) });
    return Object.fromEntries(Object.entries(client).map(([name, method]) => [name, (...args) => {
      const result = method(...args); operations.push(result); result.catch(() => {}); return result;
    }]));
  };
  f.client = f.makeClient();
  t.after(async () => {
    barriers.forEach(barrier => barrier.release());
    try { await bounded(Promise.allSettled(operations)); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  });
  return f;
}

test('激活停在租约落盘时退出：退出必须最后完成且不能恢复授权', async t => {
  const f = fixture(t); const gate = f.barrier(); const order = [];
  f.beforeRename = gate.pause;
  const activation = f.client.activate(credentials('first')).then(result => { order.push('activate'); return result; });
  await bounded(gate.entered);
  const logout = f.client.logout().then(result => { order.push('logout'); return result; });
  await nextTurn(); gate.release();
  const [activated, loggedOut] = await bounded(Promise.all([activation, logout]));
  assert.equal(activated.authorized, true);
  assert.equal(loggedOut.authorized, false);
  assert.deepEqual(order, ['activate', 'logout']);
  assert.equal((await f.client.status()).authorized, false);
  assert.equal(f.files.has(f.filename), false);
  assert.equal((await f.makeClient().status()).authorized, false);
});

test('旧续租与新账号登录并发：新登录不能被旧请求清除', async t => {
  const f = fixture(t); await f.client.activate(credentials('first'));
  const gate = f.barrier(); const order = [];
  f.respond = async route => { if (route === '/v1/leases/refresh') await gate.pause(); };
  const refresh = f.client.refresh().then(result => { order.push('refresh'); return result; });
  await bounded(gate.entered);
  const login = f.client.activate(credentials('second')).then(result => { order.push('login'); return result; });
  await nextTurn(); gate.release();
  const [renewed, loggedIn] = await bounded(Promise.all([refresh, login]));
  assert.equal(renewed.account, 'first'); assert.equal(loggedIn.account, 'second');
  assert.deepEqual(order, ['refresh', 'login']);
  assert.equal((await f.client.status()).account, 'second');
  assert.equal((await f.makeClient().status()).account, 'second');
  assert.equal(f.files.has(f.filename), true);
});

test('续租失败后队列仍执行已排队的新登录', async t => {
  const f = fixture(t); await f.client.activate(credentials('first'));
  const gate = f.barrier();
  f.respond = async route => {
    if (route === '/v1/leases/refresh') { await gate.pause(); return Response.json({ code: 'ACCOUNT_REVOKED' }, { status: 403 }); }
  };
  const rejected = assert.rejects(f.client.refresh(), { code: 'ACCOUNT_REVOKED' });
  await bounded(gate.entered);
  const login = f.client.activate(credentials('second'));
  await nextTurn(); gate.release();
  const [, state] = await bounded(Promise.all([rejected, login]));
  assert.equal(state.authorized, true); assert.equal(state.account, 'second');
  assert.equal((await f.client.status()).account, 'second');
  assert.equal(f.files.has(f.filename), true);
});

test('慢续租期间退出：不互相等待，完成后租约被清除', async t => {
  const f = fixture(t); await f.client.activate(credentials('first'));
  const gate = f.barrier();
  f.respond = async route => { if (route === '/v1/leases/refresh') await gate.pause(); };
  const refresh = f.client.refresh(); await bounded(gate.entered);
  const logout = f.client.logout(); await nextTurn(); gate.release();
  const [, state] = await bounded(Promise.all([refresh, logout]));
  assert.equal(state.authorized, false); assert.equal(f.files.has(f.filename), false);
  await assert.rejects(f.client.requireActive({ online: true }), { code: 'LICENSE_REQUIRED' });
});

test('首次激活尚未完成时续租与退出排队：全部可完成且最终锁定', async t => {
  const f = fixture(t); const gate = f.barrier();
  f.respond = async route => { if (route === '/v1/login') await gate.pause(); };
  const activation = f.client.activate(credentials('first')); await bounded(gate.entered);
  const refresh = f.client.refresh(); await nextTurn();
  const logout = f.client.logout(); gate.release();
  const [activated, renewed, loggedOut] = await bounded(Promise.all([activation, refresh, logout]));
  assert.equal(activated.authorized, true); assert.equal(renewed.authorized, true);
  assert.equal(loggedOut.authorized, false); assert.equal(f.files.has(f.filename), false);
});

test('退出后排队的续租拒绝，但后续重新登录不被阻塞', async t => {
  const f = fixture(t); await f.client.activate(credentials('first'));
  const logout = f.client.logout();
  const rejected = assert.rejects(f.client.refresh(), { code: 'LICENSE_REQUIRED' });
  await bounded(Promise.all([logout, rejected]));
  assert.equal((await bounded(f.client.activate(credentials('second')))).account, 'second');
});

test('登录校验失败不会污染队列，后续有效登录和退出均完成', async t => {
  const f = fixture(t);
  const rejected = assert.rejects(f.client.activate({ account: 'x', password: '' }), { name: 'ZodError' });
  const login = f.client.activate(credentials('first'));
  const logout = f.client.logout();
  const [, activated, loggedOut] = await bounded(Promise.all([rejected, login, logout]));
  assert.equal(activated.authorized, true); assert.equal(loggedOut.authorized, false);
  assert.equal(f.files.has(f.filename), false);
});

test('并发强制在线、状态查询与显式续租合并，完成后可再次续租', async t => {
  const f = fixture(t); await f.client.activate(credentials('first')); f.clock += 31_000;
  const gate = f.barrier();
  f.respond = async route => { if (route === '/v1/leases/refresh') await gate.pause(); };
  const refresh = f.client.refresh(); await bounded(gate.entered);
  const checks = Array.from({ length: 8 }, () => f.client.requireActive({ online: true }));
  const status = f.client.status(); await nextTurn(); gate.release();
  const [renewed, state] = await bounded(Promise.all([refresh, status, ...checks]));
  assert.equal(renewed.authorized, true); assert.equal(state.authorized, true);
  assert.equal(f.calls.filter(call => call.route === '/v1/leases/refresh').length, 1);
  await bounded(f.client.refresh());
  assert.equal(f.calls.filter(call => call.route === '/v1/leases/refresh').length, 2);
});

for (const status of [500, 502, 503, 429]) {
  test(`HTTP ${status} 拒绝新增生成但保留凭据，恢复后无需重新登录`, async t => {
    const f = fixture(t); await f.client.activate(credentials('first'));
    const saved = f.files.get(f.filename);
    f.respond = route => route === '/v1/leases/refresh'
      ? Response.json({ error: { code: 'TEMPORARY_FAILURE' } }, { status }) : undefined;
    await assert.rejects(bounded(f.client.requireActive({ online: true })), { code: 'LICENSE_OFFLINE' });
    assert.equal(f.files.get(f.filename), saved);
    assert.equal((await f.client.status()).authorized, true);
    f.respond = undefined;
    await bounded(f.client.requireActive({ online: true }));
    const restored = await bounded(f.makeClient().status());
    assert.equal(restored.authorized, true); assert.equal(restored.account, 'first');
    assert.equal(f.calls.filter(call => call.route === '/v1/login').length, 1);
  });
}

test('网络超时后退出队列可继续执行，不能恢复旧租约', async t => {
  const f = fixture(t); await f.client.activate(credentials('first'));
  const gate = f.barrier();
  f.respond = async route => {
    if (route === '/v1/leases/refresh') { await gate.pause(); throw new DOMException('模拟超时', 'TimeoutError'); }
  };
  const rejected = assert.rejects(f.client.refresh(), { code: 'LICENSE_OFFLINE' });
  await bounded(gate.entered);
  const logout = f.client.logout(); gate.release();
  const [, state] = await bounded(Promise.all([rejected, logout]));
  assert.equal(state.authorized, false); assert.equal(f.files.has(f.filename), false);
});
