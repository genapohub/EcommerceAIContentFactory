import { providerJson } from './网络.mjs';
import { AppError, assert } from './错误.mjs';

export function createProviders(config, request = providerJson, entryId) {
  const selected = capability => config.models?.resolve(capability, entryId);
  const wanHeaders = model => ({ Authorization: `Bearer ${model?.apiKey || config.key('wan')}`, 'Content-Type': 'application/json' });
  const viduHeaders = model => ({ Authorization: `Token ${model?.apiKey || config.key('vidu')}`, 'Content-Type': 'application/json' });
  function wan(path, payload, asynchronous = false, model) {
    return request((model?.baseUrl || config.wanBase()) + path, { method: 'POST', headers: { ...wanHeaders(model), ...(asynchronous ? { 'X-DashScope-Async': 'enable' } : {}) }, body: JSON.stringify(payload) });
  }
  return {
    request,
    forModel: id => id ? createProviders(config, request, id) : createProviders(config, request),
    async image({ prompt, image, aspect = '1:1' }) {
      const model = selected(image ? 'image' : 'text_image');
      const size = aspect === '3:4' ? '1152*1536' : '1280*1280';
      const content = [...(image ? [{ image }] : []), { text: prompt.slice(0, 2000) }];
      const result = await wan('/api/v1/services/aigc/multimodal-generation/generation', {
        model: image ? 'wan2.6-image' : 'wan2.6-t2i', input: { messages: [{ role: 'user', content }] },
        parameters: { size, n: 1, prompt_extend: false, watermark: false, ...(image ? { enable_interleave: false } : {}) },
      }, false, model);
      const urls = result.output?.choices?.flatMap(choice => choice.message?.content || []).filter(item => item.image).map(item => item.image) || [];
      assert(urls.length, '模型未返回图片，请在供应商控制台核对请求。', 502, 'PROVIDER_EMPTY');
      return { urls, requestId: result.request_id, usage: result.usage };
    },
    async startVideo({ image, prompt, duration = 10, audio = true }) {
      const model = selected('video');
      const result = await wan('/api/v1/services/aigc/video-generation/video-synthesis', {
        model: 'wan2.6-i2v-flash', input: { img_url: image, prompt: prompt.slice(0, 1500) },
        parameters: { resolution: '720P', duration, audio, watermark: false, prompt_extend: false },
      }, true, model);
      assert(result.output?.task_id, '未收到视频任务编号，请到百炼控制台核对。', 502, 'PROVIDER_UNCERTAIN');
      return result.output.task_id;
    },
    async startReplica({ video, images, prompt, aspect = '9:16' }) {
      const model = selected('replica');
      const body = JSON.stringify({ video_url: video, images, prompt: prompt.slice(0, 2000), aspect_ratio: aspect, resolution: '720p', remove_audio: false });
      assert(Buffer.byteLength(body) < 20 * 1024 * 1024, '参考素材组合超过Vidu请求上限，请缩短视频。');
      const result = await request('https://api.vidu.cn/ent/v2/trending-replicate', { method: 'POST', headers: viduHeaders(model), body });
      assert(result.task_id, '未收到复刻任务编号，请到Vidu控制台核对。', 502, 'PROVIDER_UNCERTAIN');
      return result.task_id;
    },
    async poll(provider, id) {
      const model = selected(provider === 'vidu' ? 'replica' : 'video');
      if (provider === 'vidu') {
        const result = await request(`https://api.vidu.cn/ent/v2/tasks/${encodeURIComponent(id)}/creations`, { headers: viduHeaders(model), timeoutMs: 30000 });
        return { state: result.state === 'success' ? 'succeeded' : result.state === 'failed' ? 'failed' : 'running',
          urls: result.creations?.map(item => item.url).filter(Boolean) || [], usage: result.credits, detail: result.err_code || '' };
      }
      const result = await request(`${model?.baseUrl || config.wanBase()}/api/v1/tasks/${encodeURIComponent(id)}`, { headers: wanHeaders(model), timeoutMs: 30000 });
      const status = result.output?.task_status;
      return { state: status === 'SUCCEEDED' ? 'succeeded' : ['FAILED', 'CANCELED'].includes(status) ? 'failed' : 'running',
        urls: result.output?.video_url ? [result.output.video_url] : [], usage: result.usage, detail: result.output?.code || '' };
    },
    async understand({ prompt, image, video }) {
      const model = selected('vision');
      const content = [{ type: 'text', text: prompt }, ...(image ? [{ type: 'image_url', image_url: { url: image } }] : []),
        ...(video ? [{ type: 'video_url', video_url: { url: video } }] : [])];
      const result = await request(`${model?.baseUrl || config.wanBase()}/compatible-mode/v1/chat/completions`, {
        method: 'POST', headers: wanHeaders(model), body: JSON.stringify({ model: model?.model || config.get().visionModel, messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' }, enable_thinking: false, max_tokens: 6000 }),
      });
      try { return JSON.parse(result.choices[0].message.content); }
      catch { throw new AppError('模型分析结果格式不完整，请重试分析。', 502, 'PROVIDER_FORMAT'); }
    },
    async check(provider) {
      if (provider === 'wan') {
        await request(`${config.wanBase()}/compatible-mode/v1/models`, { headers: wanHeaders(), timeoutMs: 20000 });
        return { provider, status: 'reachable', message: '百炼模型列表读取成功；具体生成模型权限仍需任务验证。' };
      }
      config.key('vidu');
      return { provider, status: 'configured', message: 'Vidu密钥已设置；无免费鉴权探测，本次未提交付费任务。' };
    },
  };
}
