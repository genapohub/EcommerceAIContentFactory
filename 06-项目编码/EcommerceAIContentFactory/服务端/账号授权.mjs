import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash, createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { AppError, assert } from './错误.mjs';
import { createDeviceIdentity } from './设备身份.mjs';
import { verifyLease } from '../授权服务/协议.mjs';

const credentials = z.object({ account: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/), password: z.string().min(12).max(128) }).strict();

export function createLicenseClient({ directory, env = process.env, identityFactory = createDeviceIdentity, request = fetch, now = Date.now }) {
  const filename = path.join(directory, '设备租约.json');
  let identity, signingKey, endpoint, lease, claims, initializing, pendingRefresh, encodedDeviceKey;
  let reason = '', lastOnline = 0, lastClock = 0, generation = 0;
  let mutation = Promise.resolve();
  // Serialize credential changes so a late refresh/login cannot undo a completed logout.
  function serialized(work) {
    const result = mutation.then(work, work);
    mutation = result.catch(() => {});
    return result;
  }
  const configured = Boolean(env.FACTORY_LICENSE_URL && env.FACTORY_LICENSE_PUBLIC_KEY_FILE);
  const required = () => new AppError(reason || '请先登录并激活本机。', 403, 'LICENSE_REQUIRED');
  function time() {
    const value = now();
    if (value < lastClock - 5000) { claims = undefined; reason = '系统时间发生回退，请校准时间后重新登录。'; throw required(); }
    lastClock = Math.max(value, lastClock); return value;
  }
  function decode(value, allowExpired = false) {
    const verified = verifyLease(value, { ...signingKey, issuer: endpoint.origin, now: time(), allowExpired });
    assert(verified.deviceId === createHash('sha256').update(Buffer.from(encodedDeviceKey, 'base64url')).digest('base64url')
      && verified.machineId === identity.deviceId, '授权不属于当前电脑。', 403, 'LICENSE_REQUIRED');
    return { ...verified, account: verified.username, expiresAt: verified.exp * 1000 };
  }
  async function initialize() {
    if (!initializing) initializing = (async () => {
      if (!configured) { reason = '尚未配置授权服务，请联系管理员。'; return; }
      try {
        endpoint = new URL(env.FACTORY_LICENSE_URL);
        assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && endpoint.pathname === '/', '授权服务地址无效。');
        assert(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)), '授权服务必须使用HTTPS，本机验收除外。');
        const publicKey = createPublicKey(await readFile(env.FACTORY_LICENSE_PUBLIC_KEY_FILE, 'utf8'));
        assert(publicKey.asymmetricKeyType === 'ed25519', '授权签名公钥无效。');
        signingKey = { publicKey, kid: createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('base64url') };
        identity = await identityFactory();
        encodedDeviceKey = createPublicKey(identity.publicKey).export({ type: 'spki', format: 'der' }).toString('base64url');
        try {
          const saved = JSON.parse(await readFile(filename, 'utf8'));
          if (saved.server !== endpoint.origin) throw new Error('Changed authority');
          lastClock = saved.lastClock || 0;
          lease = saved.lease; claims = decode(lease, true);
        } catch (error) {
          if (error.code !== 'ENOENT') reason = '本机授权记录已失效，请重新登录。';
          lease = undefined; claims = undefined;
        }
      } catch { reason = '授权服务或设备身份配置无效，请联系管理员。'; }
    })();
    return initializing;
  }
  async function call(route, body) {
    let response;
    try { response = await request(new URL(route, endpoint), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new AppError('暂时无法连接授权服务，请检查网络后重试。', 503, 'LICENSE_OFFLINE'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data.error?.code || data.code;
      if (response.status >= 500 || response.status === 429) throw new AppError('授权服务暂时不可用，请稍后重试。', 503, 'LICENSE_OFFLINE');
      const messages = { DEVICE_ALREADY_BOUND: '该账号已绑定其他电脑，请联系管理员办理换机。', INVALID_CREDENTIALS: '账号或密码不正确。', ACCOUNT_REVOKED: '账号已停用或设备授权变更，请联系管理员。', LICENSE_REVOKED: '设备授权已撤销，请联系管理员。', RATE_LIMITED: '操作过于频繁，请稍后重试。' };
      throw new AppError(messages[code] || '授权校验未通过，请检查账号或联系管理员。', response.status >= 500 ? 503 : 403, code || 'LICENSE_REQUIRED');
    }
    return data;
  }
  async function proof(account, purpose) {
    const fields = { username: account, machineId: identity.deviceId, devicePublicKey: encodedDeviceKey };
    const challenge = await call('/v1/challenges', { ...fields, purpose });
    assert(typeof challenge.signingInput === 'string' && challenge.signingInput.length < 4096 && typeof challenge.challengeId === 'string', '授权服务响应无效。', 502);
    return { challengeId: challenge.challengeId, signature: Buffer.from(await identity.sign(challenge.signingInput)).toString('base64url') };
  }
  async function accept(value, revision) {
    const verified = decode(value);
    assert(revision === generation, '登录状态已变化，请重试。', 409);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify({ server: endpoint.origin, lease: value, lastClock: time() }), { mode: 0o600, flag: 'wx' });
      assert(revision === generation, '登录状态已变化，请重试。', 409);
      await rename(temporary, filename);
      lease = value; claims = verified; reason = ''; lastOnline = time();
    } finally { await unlink(temporary).catch(() => {}); }
  }
  function snapshot() {
    let authorized = false;
    try { authorized = Boolean(claims && lastOnline && decode(lease)); } catch { authorized = false; }
    return { configured, authorized, account: claims?.account || null, deviceId: identity?.deviceId || null, devicePublicKey: encodedDeviceKey || null,
      expiresAt: claims?.expiresAt || null, message: authorized ? '此账号已授权当前电脑' : reason || '登录后激活当前电脑' };
  }
  async function refresh() {
    await initialize();
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = serialized(async () => {
      const revision = generation;
      try {
        assert(lease && identity, '请先登录并激活本机。', 403, 'LICENSE_REQUIRED');
        const fields = await proof(claims?.account || decode(lease, true).account, 'refresh');
        const data = await call('/v1/leases/refresh', { ...fields, lease });
        await accept(data.lease, revision); return snapshot();
      } catch (error) {
        if (error.code !== 'LICENSE_OFFLINE') { claims = undefined; lease = undefined; await unlink(filename).catch(() => {}); }
        reason = error.message; throw error;
      } finally { pendingRefresh = undefined; }
    });
    return pendingRefresh;
  }
  return {
    async status() {
      await initialize();
      if (lease && (!lastOnline || time() - lastOnline > 30000)) await refresh().catch(() => {});
      return snapshot();
    },
    activate(input) { return serialized(async () => {
      const { account, password } = credentials.parse(input); await initialize();
      assert(configured && identity && signingKey, reason || '请先配置授权服务。', 403, 'LICENSE_REQUIRED');
      const revision = ++generation;
      const fields = await proof(account, 'login');
      const result = await call('/v1/login', { ...fields, username: account, password });
      await accept(result.lease, revision); return snapshot();
    }); },
    refresh,
    logout() { return serialized(async () => {
      generation++; await initialize();
      claims = undefined; lease = undefined; reason = '已退出登录，设备绑定仍保留。';
      await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); return snapshot();
    }); },
    async requireActive({ online = false } = {}) {
      await initialize();
      if (lease && (online || !lastOnline || time() - lastOnline > 30000)) await refresh();
      if (!snapshot().authorized) throw required();
    },
    close: () => mutation,
  };
}
