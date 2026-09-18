import express from 'express';
import { isIP } from 'node:net';
import { z } from 'zod';
import { openAccountStore } from './账号存储.mjs';
import { AuthError, signingIdentity } from './密码与签名.mjs';
import { challengeSchema, loginSchema, refreshSchema } from './请求校验.mjs';
import { createAuthorizationService } from './授权逻辑.mjs';

/** 演示模式只允许实际 loopback 对端，不信任转发头。 */
export function isLoopback(address) {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

/** 独立应用装配；测试可注入时钟，生产入口不可通过 NODE_ENV 放宽。 */
export function createAuthorizationApp({
  databasePath, signingKey, issuer, mode = 'production', trustedProxyIps = [],
  leaseSeconds = 300, challengeSeconds = 60, now = Date.now,
  rateLimit = { ip: 240, account: 10, challenge: 60, refresh: 60, windowMs: 60000 },
} = {}) {
  if (!['production', 'demo'].includes(mode)) throw new Error('运行模式无效');
  const url = new URL(issuer);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.origin !== issuer) {
    throw new Error('issuer 必须为无路径、无凭据的规范 origin');
  }
  if (mode === 'production' ? url.protocol !== 'https:'
    : !['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error('生产入口必须为 HTTPS，演示入口必须为 loopback');
  }
  if (!Array.isArray(trustedProxyIps) || trustedProxyIps.some((ip) => !isIP(ip))
    || (mode === 'demo' && trustedProxyIps.length)) throw new Error('代理必须是明确的 IP，演示模式不信任代理');
  const challengeLimit = rateLimit.challenge ?? 60;
  const refreshLimit = rateLimit.refresh ?? 60;
  for (const [value, min, max] of [[leaseSeconds, 10, 300], [challengeSeconds, 1, 60],
    [rateLimit.ip, 1, 10000], [rateLimit.account, 1, 1000], [challengeLimit, 1, 1000],
    [refreshLimit, 1, 1000], [rateLimit.windowMs, 1000, 3600000]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('授权时间或限流配置无效');
  }
  const identity = signingIdentity(signingKey);
  const store = openAccountStore(databasePath);
  const service = createAuthorizationService({ store, signingKey, identity, issuer, leaseSeconds, challengeSeconds, now });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustedProxyIps.length ? trustedProxyIps : false);

  /** IP 限流在 JSON 解析之前，错误响应也禁缓存；绝不输出原始请求和异常。 */
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (mode === 'demo' && !isLoopback(req.socket.remoteAddress)) {
      return next(new AuthError(403, 'LOOPBACK_ONLY', '演示服务仅允许本机连接'));
    }
    if (mode === 'production' && !req.secure) return next(new AuthError(403, 'HTTPS_REQUIRED', '授权接口必须使用 HTTPS'));
    if (mode === 'production') res.set('Strict-Transport-Security', 'max-age=31536000');
    const retry = store.takeRateLimit('ip', req.ip, rateLimit.ip, rateLimit.windowMs, now());
    if (retry) {
      res.set('Retry-After', String(retry));
      return next(new AuthError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'));
    }
    if (req.method === 'POST' && (!req.is('application/json')
      || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity'))) {
      return next(new AuthError(415, 'JSON_REQUIRED', '请发送未压缩的 application/json'));
    }
    next();
  });
  app.use(express.json({ limit: '8kb', strict: true, inflate: false }));

  /** 密码尝试、挑战和续期独立计费，避免业务提交消耗密码防爆破额度。 */
  function limitAccount(scope, username, limit, res) {
    const retry = store.takeRateLimit(scope, username, limit, rateLimit.windowMs, now());
    if (retry) {
      res.set('Retry-After', String(retry));
      throw new AuthError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    }
  }

  app.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [identity.jwk] }));
  app.post('/v1/challenges', (req, res) => {
    const input = challengeSchema.parse(req.body);
    limitAccount('challenge', input.username, challengeLimit, res);
    res.status(201).json(service.createChallenge(input));
  });
  app.post('/v1/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    limitAccount('login', input.username, rateLimit.account, res);
    res.json(await service.login(input));
  });
  app.post('/v1/leases/refresh', (req, res) => {
    const input = refreshSchema.parse(req.body);
    limitAccount('refresh', service.readRefreshClaims(input.lease).username, refreshLimit, res);
    res.json(service.refresh(input));
  });
  app.use((_req, _res, next) => next(new AuthError(404, 'NOT_FOUND', '接口不存在')));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError || error.type === 'entity.parse.failed') {
      error = new AuthError(400, 'INVALID_INPUT', '请求字段、类型或 JSON 格式无效');
    } else if (error.type === 'entity.too.large') {
      error = new AuthError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 8KB');
    } else if (error.status === 415) {
      error = new AuthError(415, 'JSON_REQUIRED', '请发送 UTF-8 application/json');
    }
    const known = error instanceof AuthError;
    res.status(known ? error.status : 500).json({ error: {
      code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '授权服务内部错误',
    } });
  });
  return { app, store, publicJwk: identity.jwk, close: () => store.close() };
}
