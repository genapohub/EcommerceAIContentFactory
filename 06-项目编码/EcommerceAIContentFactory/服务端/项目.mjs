import { z } from 'zod';
import { assert } from './错误.mjs';

const text = (max = 2000) => z.string().max(max).default('');
const pointSchema = z.object({ id: text(50), title: text(80), proof: text(500), locked: z.boolean().default(false) });
const screenSchema = z.object({ id: text(50), title: text(60), copy: text(500), prompt: text(1000), pointId: text(50) });
const shotSchema = z.object({ time: text(40), action: text(500), caption: text(160) });
const videoSchema = z.object({ id: text(50), title: text(80), hook: text(200), voiceover: text(1500), shots: z.array(shotSchema).max(12), cta: text(200) });
export const planSchema = z.object({
  source: z.enum(['draft', 'ai']).default('draft'), points: z.array(pointSchema).max(12),
  screens: z.array(screenSchema).min(1).max(8), videos: z.array(videoSchema).max(3),
  reference: z.object({ source: z.enum(['unread', 'ai']).default('unread'), hook: text(300), pain: text(500), proof: text(500), cta: text(300), shots: z.array(shotSchema).max(30) }).optional(),
});
const fieldsSchema = z.object({ name: text(100), category: text(40), price: text(100), audience: text(400), specs: text(), claims: text(), brief: text(1500), referenceUrl: text(2000), referenceText: text(3000) });
export const projectSchema = z.object({ fields: fieldsSchema, imageId: z.string().uuid().nullable().default(null), referenceId: z.string().uuid().nullable().default(null), plan: planSchema.optional() });

export function draftPlan(fields = {}) {
  const summary = (value, limit) => value.length <= limit ? value : value.slice(0, limit - 1) + '…';
  const points = (fields.claims || '').split(/[，,；;\n]/).map(t => t.trim()).filter(Boolean).slice(0, 6).map((title, index) => ({ id: `point-${index}`, title: summary(title, 80), proof: '', locked: false }));
  const titles = ['商品亮相', '核心卖点', '使用场景', '细节展示', '规格与包装', '购买须知'];
  const screens = titles.map((title, i) => ({ id: `screen-${i}`, title: i === 0 ? summary(fields.name || title, 60) : title,
    copy: i === 1 ? points.map(p => p.title).join(' · ') : i === 4 ? summary(fields.specs || '', 500) : i === 0 && fields.name?.length > 60 ? fields.name : '',
    prompt: `商品${title}场景，保持原商品造型、颜色和标志，干净清晰，不添加文字，不虚构材质或功能。`, pointId: points[i % Math.max(points.length, 1)]?.id || '' }));
  const videos = ['场景展示', '细节特写', '卖点介绍'].map((title, i) => ({ id: `video-${i}`, title,
    hook: fields.name ? `看看这款${fields.name}` : '', voiceover: points.map(p => p.title).join('。'),
    shots: [{ time: '0–3秒', action: '商品整体近景，保持外观一致', caption: fields.name || '' },
      { time: '3–7秒', action: i === 1 ? '缓慢移动镜头，展示可见细节' : '商品场景展示，不改变商品结构', caption: points[0]?.title || '' },
      { time: '7–10秒', action: '商品定格，干净背景', caption: fields.price || '' }], cta: '查看商品详情' }));
  return { source: 'draft', points, screens, videos, reference: { source: 'unread', hook: '', pain: '', proof: '', cta: '', shots: [] } };
}

export function checkContent(project) {
  const content = JSON.stringify({ fields: project.fields, plan: project.plan });
  const terms = ['最强', '第一', '全网最低', '100%有效', '根治', '永久有效', '绝对', '零风险', '保证治愈'];
  const normalize = value => String(value || '').replace(/[\s\p{P}]/gu, '');
  const reference = normalize(project.fields.referenceText);
  const candidates = [...project.plan.screens.map(s => s.copy), ...project.plan.videos.flatMap(v => [v.hook, v.voiceover, v.cta])].map(normalize);
  const copied = reference.length >= 20 && candidates.some(value => {
    for (let i = 0; i <= value.length - 20; i++) if (reference.includes(value.slice(i, i + 20))) return true;
    return false;
  });
  const missingPoints = project.plan.screens.filter(s => s.pointId && !project.plan.points.some(p => p.id === s.pointId)).map(s => s.title);
  return { terms: terms.filter(t => content.includes(t)), copied, missingPoints, unproven: project.plan.points.filter(p => !p.proof).map(p => p.title),
    notes: [project.plan.source === 'ai' ? 'AI候选卖点需对照实物确认。' : '当前为人工资料草稿，尚未进行AI识别。',
      project.plan.reference?.source === 'ai' ? '参考结构已分析，发布前确认使用自有素材。' : '参考视频尚未进行AI分析。'] };
}

export function createProjects(store, media) {
  const imports = new Map();
  async function importing(id, callback) {
    store.require('projects', id);
    imports.set(id, (imports.get(id) || 0) + 1);
    try { return await callback(); }
    finally {
      const count = imports.get(id) - 1;
      if (count) imports.set(id, count); else imports.delete(id);
    }
  }
  function detail(id) {
    const project = store.require('projects', id);
    return { ...project, assets: store.list('assets', a => a.projectId === id).map(media.public),
      jobs: store.list('jobs', j => j.projectId === id).map(({ snapshot, resultUrls, ...job }) => job), check: checkContent(project) };
  }
  return {
    detail,
    list: () => store.list('projects').map(({ id, fields, updatedAt, createdAt }) => ({ id, name: fields.name || '未命名商品', category: fields.category, updatedAt, createdAt })),
    create(input = {}) {
      const fields = fieldsSchema.parse(input.fields || {});
      const project = store.save('projects', { fields, imageId: null, referenceId: null, plan: draftPlan(fields) });
      return detail(project.id);
    },
    rename(id, input) {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(input);
      const current = store.require('projects', id);
      store.save('projects', { ...current, fields: { ...current.fields, name } });
      return detail(id);
    },
    async remove(id) {
      assert(!imports.has(id), '项目正在导入素材，请完成后再删除。', 409, 'PROJECT_BUSY');
      const assets = store.list('assets', asset => asset.projectId === id);
      store.removeProject(id);
      return { id, deleted: true, cleanupPending: await media.removeAssets(assets) };
    },
    update(id, input) {
      const current = store.require('projects', id);
      const values = projectSchema.parse({ ...current, ...input });
      if (input.fields && !input.plan && JSON.stringify(current.plan) === JSON.stringify(draftPlan(current.fields))) values.plan = draftPlan(values.fields);
      for (const [key, kind] of [['imageId', 'product'], ['referenceId', 'reference']]) {
        if (values[key]) {
          const asset = store.require('assets', values[key]);
          assert(asset.projectId === id && (kind === 'product' ? asset.mime.startsWith('image/') : asset.mime.startsWith('video/')), '素材不属于当前项目或类型不匹配。');
        }
      }
      store.save('projects', { ...current, ...values });
      return detail(id);
    },
    async upload(id, bytes, { kind, name }) {
      return importing(id, async () => {
      assert(['product', 'reference'].includes(kind), '素材用途无效。');
      const asset = await media.save(bytes, { projectId: id, kind, name });
      const expected = kind === 'product' ? 'image/' : 'video/';
      assert(asset.mime.startsWith(expected), kind === 'product' ? '请选择商品图片。' : '请选择参考视频。');
      store.save('projects', { ...store.require('projects', id), [kind === 'product' ? 'imageId' : 'referenceId']: asset.id });
      return detail(id);
      });
    },
    async reference(id, url) {
      return importing(id, async () => {
      const asset = await media.importUrl(id, url);
      const latest = store.require('projects', id);
      store.save('projects', { ...latest, referenceId: asset.id, fields: { ...latest.fields, referenceUrl: url } });
      return detail(id);
      });
    },
  };
}
