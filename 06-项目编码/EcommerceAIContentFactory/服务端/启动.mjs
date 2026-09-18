import path from 'node:path';
import { createApplication, root } from './应用.mjs';
import { acquireInstance } from './实例锁.mjs';

const preferredPort = Number(process.env.FACTORY_PORT || 5188);
if (!Number.isInteger(preferredPort) || preferredPort < 1024 || preferredPort > 65525) throw new Error('FACTORY_PORT需要1024至65525之间的整数。');
try {
  const response = await fetch(`http://127.0.0.1:${preferredPort}/healthz`, { signal: AbortSignal.timeout(800) });
  const existing = await response.json();
  if (existing.status === 'ok' && existing.mode === 'local-single-user' && existing.version === '2.0.0') {
    console.log(`内容工厂服务已运行，请打开 http://127.0.0.1:${preferredPort}/工作台.html。更新后请先结束原服务再启动。`);
    process.exit(0);
  }
} catch {}
const release = acquireInstance(path.join(root, '运行数据'));
process.once('exit', release);
const application = createApplication();
function listen(port) {
  const server = application.app.listen(port, '127.0.0.1', () => {
    console.log(`电商AI内容工厂已启动：http://127.0.0.1:${port}/工作台.html`);
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE' && port < preferredPort + 10) listen(port + 1);
    else { console.error('服务启动失败，请检查端口和数据目录权限。'); process.exitCode = 1; }
  });
}
listen(preferredPort);
