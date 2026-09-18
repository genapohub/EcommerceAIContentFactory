import { z } from 'zod';
import { AppError } from './错误.mjs';
import { createModelCatalog } from './模型目录.mjs';

const configSchema = z.object({
  wanKey: z.string().max(500).optional(), viduKey: z.string().max(500).optional(),
  clearWan: z.boolean().optional(), clearVidu: z.boolean().optional(),
  workspaceId: z.string().regex(/^[a-zA-Z0-9-]*$/).max(80).default(''),
  visionModel: z.enum(['qwen3-vl-plus', 'qwen3-vl-flash']).default('qwen3-vl-plus'),
  maxTaskYuan: z.number().min(1).max(1000).default(100),
  viduSecondYuan: z.number().min(0.01).max(20).default(0.5),
  viduBillingConfirmed: z.boolean().default(false),
});

export function createConfig(store, env = process.env) {
  let secrets = { wanKey: env.DASHSCOPE_API_KEY || '', viduKey: env.VIDU_API_KEY || '' };
  let settings = { ...configSchema.parse({}), ...(store.get('settings', 'providers')?.values || {}) };
  const models = createModelCatalog(store, { settings: () => settings, secret: provider => secrets[provider === 'vidu' ? 'viduKey' : 'wanKey'] });
  function publicConfig() {
    return { ...settings, models: models.list(), modelOrder: 'updated_desc', modelTemplates: models.templates, hasWanKey: models.list().some(m => m.provider === 'wan' && m.enabled && m.hasKey), hasViduKey: models.list().some(m => m.provider === 'vidu' && m.enabled && m.hasKey),
      wanKeySource: env.DASHSCOPE_API_KEY ? '环境变量' : '本次服务会话',
      viduKeySource: env.VIDU_API_KEY ? '环境变量' : '本次服务会话' };
  }
  return {
    models,
    public: publicConfig,
    get: () => settings,
    save(input) {
      const parsed = configSchema.parse({ ...settings, ...input });
      const { wanKey, viduKey, clearWan, clearVidu, ...values } = parsed;
      if (clearWan) secrets.wanKey = '';
      else if (wanKey?.trim()) secrets.wanKey = wanKey.trim();
      if (clearVidu) secrets.viduKey = '';
      else if (viduKey?.trim()) secrets.viduKey = viduKey.trim();
      settings = values;
      store.save('settings', { id: 'providers', values });
      return publicConfig();
    },
    key(provider) {
      const value = secrets[provider === 'vidu' ? 'viduKey' : 'wanKey'];
      if (!value) throw new AppError(`请先在国内模型配置中填写${provider === 'vidu' ? 'Vidu' : '百炼'} API Key。`, 409, 'MISSING_CONFIG');
      return value;
    },
    wanBase: () => settings.workspaceId ? `https://${settings.workspaceId}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com',
  };
}
