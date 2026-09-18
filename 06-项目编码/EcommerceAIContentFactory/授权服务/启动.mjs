import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAuthorizationApp } from './应用.mjs';

/** 独立启动，仅监听 IPv4 loopback；生产 TLS 由同机反向代理终止。 */
export async function startAuthorizationServer(env = process.env, args = process.argv.slice(2)) {
  if (args.some((value) => value !== '--本机验收') || args.length > 1) throw new Error('启动参数无效');
  const mode = args.includes('--本机验收') ? 'demo' : 'production';
  const port = Number(env.AUTH_PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');
  if (!env.AUTH_DATABASE_PATH || !env.AUTH_SIGNING_KEY_FILE) throw new Error('缺少独立数据库或签名私钥路径');
  const issuer = env.AUTH_ISSUER || (mode === 'demo' ? `http://127.0.0.1:${port}` : undefined);
  if (!issuer) throw new Error('生产必须配置 HTTPS AUTH_ISSUER');
  const trustedProxyIps = mode === 'demo' ? [] : (env.AUTH_TRUSTED_PROXY_IPS || '').split(',').filter(Boolean);
  if (mode === 'production' && !trustedProxyIps.length) throw new Error('生产必须配置同机可信代理 IP');
  if (trustedProxyIps.some((ip) => !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip))) {
    throw new Error('当前启动入口仅支持同机代理');
  }
  const signingKey = createPrivateKey(await readFile(resolve(env.AUTH_SIGNING_KEY_FILE)));
  const authority = createAuthorizationApp({ databasePath: resolve(env.AUTH_DATABASE_PATH), signingKey, issuer, mode, trustedProxyIps });
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }, authority.app);
  try {
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', fail); done(); });
    });
  } catch (error) {
    authority.close();
    throw error;
  }
  let stopping;
  const stop = () => stopping ??= new Promise((done, fail) => {
    server.close((error) => { authority.close(); error ? fail(error) : done(); });
  });
  return { server, authority, stop };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startAuthorizationServer().then(({ stop }) => {
    process.stdout.write('独立授权服务已启动，仅监听本机；未连接主应用数据库。\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
  }).catch(() => {
    process.stderr.write('授权服务启动失败：请检查独立路径、Ed25519密钥、端口和HTTPS代理配置。\n');
    process.exitCode = 1;
  });
}
