import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { assert } from './错误.mjs';
import { providerJson } from './网络.mjs';

export function createRoutes({ store, projects, jobs, config, providers, media, exportProject, token, license }) {
  const api = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 2 } });
  api.get('/session', (_req, res) => res.json({ token }));
  api.use(async (req, _res, next) => {
    if (!/^\/(license|config)(\/|$)/.test(req.path)) await license.requireActive();
    next();
  });
  api.get('/assets/:id', (req, res) => {
    const asset = store.require('assets', req.params.id);
    if (req.query.poster === '1') {
      assert(asset.posterFilename, '此视频没有封面。', 404);
      return res.type('jpg').sendFile(media.filename({ filename: asset.posterFilename }));
    }
    res.set('Cache-Control', 'private, max-age=3600').set('Content-Type', asset.mime);
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`);
    res.sendFile(media.filename(asset));
  });
  api.use((req, _res, next) => { assert(req.get('X-Factory-Token') === token, '会话已失效，请刷新工作台。', 401, 'UNAUTHORIZED'); next(); });
  api.get('/license', async (_req, res) => res.json(await license.status()));
  api.post('/license/activate', async (req, res) => res.json(await license.activate(req.body)));
  api.post('/license/refresh', async (_req, res) => res.json(await license.refresh()));
  api.post('/license/logout', async (_req, res) => res.json(await license.logout()));
  api.get('/projects', (_req, res) => res.json(projects.list()));
  api.post('/projects', (req, res) => res.status(201).json(projects.create(req.body)));
  api.get('/projects/:id', (req, res) => res.json(projects.detail(req.params.id)));
  api.patch('/projects/:id', (req, res) => res.json(projects.update(req.params.id, req.body)));
  api.patch('/projects/:id/name', (req, res) => res.json(projects.rename(req.params.id, req.body)));
  api.delete('/projects/:id', async (req, res) => res.json(await projects.remove(req.params.id)));
  api.post('/projects/:id/assets', upload.single('file'), async (req, res) => {
    assert(req.file, '请选择素材文件。');
    res.status(201).json(await projects.upload(req.params.id, req.file.buffer, { kind: req.body.kind, name: Buffer.from(req.file.originalname, 'latin1').toString('utf8') }));
  });
  api.post('/projects/:id/reference', async (req, res) => {
    const { url } = z.object({ url: z.string().url().max(2000) }).parse(req.body);
    res.status(201).json(await projects.reference(req.params.id, url));
  });
  api.get('/config', (_req, res) => res.json(config.public()));
  api.put('/config', (req, res) => res.json(config.save(req.body)));
  api.post('/config/models', (req, res) => res.status(201).json(config.models.save(req.body)));
  api.patch('/config/models/:id', (req, res) => res.json(config.models.save(req.body, req.params.id)));
  api.delete('/config/models/:id', (req, res) => res.json(config.models.remove(req.params.id)));
  api.post('/config/models/:id/check', async (req, res) => res.json(await config.models.check(req.params.id, providers.request || providerJson)));
  api.post('/config/check', async (req, res) => {
    const provider = z.enum(['wan', 'vidu']).parse(req.body.provider);
    res.json(await providers.check(provider));
  });
  api.post('/quotes', (req, res) => res.json(jobs.quote(req.body)));
  api.get('/jobs', (_req, res) => res.json(jobs.list()));
  api.post('/jobs', async (req, res) => { await license.requireActive({ online: true }); res.status(202).json(jobs.create(req.body, req.get('Idempotency-Key'))); });
  api.post('/jobs/:id/retry', async (req, res) => { await license.requireActive({ online: true }); res.status(202).json(jobs.retry(req.params.id, req.body)); });
  api.post('/jobs/:id/apply', (req, res) => { const project = jobs.applyAnalysis(req.params.id); res.json(projects.detail(project.id)); });
  api.get('/projects/:id/export', async (req, res) => exportProject(req.params.id, req.query.format || 'zip', res));
  return api;
}
