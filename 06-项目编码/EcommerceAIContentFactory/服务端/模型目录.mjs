import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assert } from './错误.mjs';

export const modelTemplates = [
  { id: 'wan-text', provider: 'wan', capability: 'text_image', label: '万相文生图', model: 'wan2.6-t2i' },
  { id: 'wan-image', provider: 'wan', capability: 'image', label: '万相图生图', model: 'wan2.6-image' },
  { id: 'wan-video', provider: 'wan', capability: 'video', label: '万相图生视频', model: 'wan2.6-i2v-flash' },
  { id: 'qwen-plus', provider: 'wan', capability: 'vision', label: '通义视觉 Plus', model: 'qwen3-vl-plus' },
  { id: 'qwen-flash', provider: 'wan', capability: 'vision', label: '通义视觉 Flash', model: 'qwen3-vl-flash' },
  { id: 'vidu-replica', provider: 'vidu', capability: 'replica', label: 'Vidu 视频复刻', model: 'trending-replicate' },
];
export const taskCapability = { main_image: 'image', detail_image: 'image', text_image: 'text_image', intro_video: 'video', replica_video: 'replica', product_analysis: 'vision', reference_analysis: 'vision' };
const entrySchema = z.object({ name: z.string().trim().min(1).max(80), templateId: z.enum(modelTemplates.map(t => t.id)),
  workspaceId: z.string().regex(/^[a-zA-Z0-9-]*$/).max(80).default(''), apiKey: z.string().max(500).optional(),
  clearKey: z.boolean().optional(), enabled: z.boolean().default(false) });

export function createModelCatalog(store, legacy) {
  const secrets = new Map();
  const checks = new Map();
  const inFlight = new Set();
  let entries = store.get('settings', 'model-catalog')?.entries || modelTemplates.filter(t => t.id !== (legacy.settings().visionModel === 'qwen3-vl-flash' ? 'qwen-plus' : 'qwen-flash')).map(t => ({
    id: randomUUID(), name: t.label, templateId: t.id, workspaceId: legacy.settings().workspaceId || '', enabled: true, revision: 0,
  }));
  const template = entry => modelTemplates.find(t => t.id === entry.templateId);
  const key = entry => secrets.has(entry.id) ? secrets.get(entry.id) : legacy.secret(template(entry).provider);
  const base = entry => template(entry).provider === 'vidu' ? 'https://api.vidu.cn' : entry.workspaceId ? `https://${entry.workspaceId}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com';
  const persist = () => store.save('settings', { id: 'model-catalog', entries });
  persist();
  function requireEntry(id) { const entry = entries.find(e => e.id === id); assert(entry, '模型配置不存在。', 404); return entry; }
  function publicEntry(entry) { return { ...entry, ...template(entry), id: entry.id, baseUrl: base(entry), hasKey: Boolean(key(entry)), check: checks.get(entry.id) || { status: 'untested', message: '尚未测试' } }; }
  function resolve(capability, id) {
    const entry = id ? requireEntry(id) : entries.find(e => e.enabled && template(e).capability === capability);
    assert(entry && template(entry).capability === capability, '此能力没有已启用的模型。', 409, 'MODEL_DISABLED');
    assert(key(entry), '请先填写该模型的 API Key。', 409, 'MISSING_CONFIG');
    return { ...publicEntry(entry), apiKey: key(entry) };
  }
  return {
    list: () => entries.map((entry, index) => ({ entry, index })).sort((a, b) =>
      (Date.parse(b.entry.updatedAt || b.entry.createdAt) || 0) - (Date.parse(a.entry.updatedAt || a.entry.createdAt) || 0)
      || b.index - a.index).map(({ entry }) => publicEntry(entry)), templates: modelTemplates, resolve,
    require: id => publicEntry(requireEntry(id)),
    remove(id) {
      const entry = requireEntry(id);
      assert(!entry.enabled, '请先停用模型，再删除配置。', 409, 'MODEL_ENABLED');
      assert(!inFlight.has(id), '连接测试进行中，请稍后删除。', 409, 'MODEL_BUSY');
      assert(!store.list('jobs', j => j.modelEntryId === id && ['queued', 'running', 'needs_review'].includes(j.status)).length,
        '该模型有运行中或待核对的任务，请处理完成后再删除。', 409, 'MODEL_BUSY');
      entries = entries.filter(e => e.id !== id);
      secrets.delete(id); checks.delete(id); persist();
      return { id, deleted: true };
    },
    save(input, id) {
      const old = id ? requireEntry(id) : null;
      const parsed = entrySchema.parse({ ...old, ...input });
      const providerChanged = old && template(old).provider !== template(parsed).provider;
      if (old && old.templateId !== parsed.templateId) assert(!store.list('jobs', j => j.modelEntryId === id && ['queued', 'running', 'needs_review', 'failed'].includes(j.status)).length,
        '该配置仍有关联的未完成任务，请新增模型配置，或处理任务后再切换模型。', 409, 'MODEL_BUSY');
      if (providerChanged) {
        parsed.workspaceId = '';
        assert(!parsed.enabled || Boolean(parsed.apiKey?.trim()) && !parsed.clearKey, '切换厂商后请填写新厂商的 API Key，或先关闭启用。', 409, 'MISSING_CONFIG');
      }
      if (old) assert(!store.list('jobs', j => j.modelEntryId === id && ['queued', 'running'].includes(j.status)).length || Object.keys(input).every(k => ['enabled', 'name'].includes(k)), '该模型有运行中的任务，请待任务结束后编辑接入参数。', 409);
      const { apiKey, clearKey, ...values } = parsed;
      const latest = Math.max(0, ...entries.map(e => Date.parse(e.updatedAt) || 0));
      const now = Math.max(Date.now(), latest + 2);
      const entry = { ...values, id: id || randomUUID(), revision: (old?.revision || 0) + 1,
        createdAt: old ? old.createdAt || null : new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
      if (entry.enabled) entries = entries.map(e => e.enabled && template(e).capability === template(entry).capability
        ? { ...e, enabled: false, updatedAt: new Date(now - 1).toISOString() } : e);
      entries = old ? entries.map(e => e.id === id ? entry : e) : [...entries, entry];
      if (clearKey) secrets.set(entry.id, ''); else if (apiKey?.trim()) secrets.set(entry.id, apiKey.trim()); else if (providerChanged) secrets.set(entry.id, '');
      if (!old || clearKey || apiKey?.trim() || old.templateId !== entry.templateId || old.workspaceId !== entry.workspaceId) checks.delete(entry.id);
      persist(); return publicEntry(entry);
    },
    async check(id, request) {
      const entry = requireEntry(id); const revision = entry.revision;
      assert(!inFlight.has(id), '此模型正在测试，请稍候。', 409);
      inFlight.add(id); const start = Date.now();
      let result;
      try {
        const model = resolve(template(entry).capability, id);
        if (model.provider === 'vidu') result = { status: 'unverified', message: '密钥已配置；当前复刻接口没有已核实的免费鉴权探测，连接与权限待实际任务验证。' };
        else {
          const response = await request(`${model.baseUrl}/compatible-mode/v1/models`, { headers: { Authorization: `Bearer ${model.apiKey}` }, timeoutMs: 20000 });
          assert(Array.isArray(response.data), '模型列表响应格式无效。');
          result = { status: 'reachable', message: '百炼接口连通；具体模型权限和生成效果仍需实际任务验证。' };
        }
      } catch { result = { status: 'failed', message: key(entry) ? '连接测试失败，请检查密钥、业务空间、网络与账号权限。' : '未配置 API Key。' }; }
      finally { inFlight.delete(id); }
      result = { ...result, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start };
      if (requireEntry(id).revision === revision) checks.set(id, result);
      return publicEntry(requireEntry(id));
    },
  };
}
