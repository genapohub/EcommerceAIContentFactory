import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ZodError } from 'zod';
import { createStore } from './存储.mjs';
import { createConfig } from './配置.mjs';
import { createMedia } from './媒体.mjs';
import { createProviders } from './模型适配.mjs';
import { createProjects } from './项目.mjs';
import { createJobs } from './任务.mjs';
import { createExports } from './导出.mjs';
import { createRoutes } from './路由.mjs';
import { AppError } from './错误.mjs';
import { createLicenseClient } from './账号授权.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createApplication(options = {}) {
  const store = createStore(options.dataDir || path.join(root, '运行数据'));
  const config = createConfig(store, options.env);
  const license = options.license || createLicenseClient({ directory: store.directory, env: options.env || process.env });
  const media = createMedia(store, options.downloader);
  const providers = options.providers || createProviders(config, options.providerRequest);
  const projects = createProjects(store, media);
  const jobs = createJobs({ store, config, media, providers, license, pollMs: options.pollMs, maxPolls: options.maxPolls });
  const app = express();
  const token = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.get('host') || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).json({ message: '本机工作台仅接受本机访问。' });
    const origin = req.get('origin');
    if ((origin && origin !== `http://${host}`) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ message: '不允许跨站访问工作台。' });
    res.set('X-Content-Type-Options', 'nosniff').set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    next();
  });
  app.use(express.json({ limit: '300kb' }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok', version: '2.0.0', mode: 'local-single-user' }));
  app.use('/api/v1', createRoutes({ store, projects, jobs, config, providers, media, exportProject: createExports(store, media), token, license }));
  app.get(['/', encodeURI('/工作台.html')], (_req, res) => res.sendFile(path.join(root, '前端/工作台.html')));
  app.use('/static', express.static(path.join(root, '前端'), { index: false }));
  app.use('/vendor/lucide', express.static(path.join(root, 'node_modules/lucide/dist/umd'), { index: false }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const invalid = error instanceof ZodError;
    const large = error.code === 'LIMIT_FILE_SIZE';
    const message = invalid ? '输入格式不正确，请检查内容长度、数值与素材。' : large ? '文件超过100MB，请压缩后上传。'
      : error instanceof AppError ? error.message : '服务处理失败，请检查素材和服务运行状态。';
    res.status(invalid ? 400 : large ? 413 : error.status || 500).json({ code: error.code || 'ERROR', message });
  });
  if (options.startJobs !== false) jobs.start();
  return { app, store, config, projects, jobs, media, providers, license, async close() { await jobs.stop(); await license.close?.(); store.close(); } };
}
