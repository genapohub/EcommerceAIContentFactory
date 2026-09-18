import { AppError, assert } from './错误.mjs';
import { renderScreen } from './排版.mjs';
import { analyzeProduct, analyzeReference } from './分析.mjs';

export function createExecutor({ store, media, providers, license, pollMs = 5000, maxPolls = 360 }) {
  const save = (job, patch) => { Object.assign(job, patch); store.save('jobs', job); };
  async function makeDetail(job, source) {
    const screen = job.snapshot.plan.screens[job.index];
    const image = await renderScreen(media.filename(source), screen, job.index);
    return media.save(image, { projectId: job.projectId, jobId: job.id, kind: 'detail_image', name: `${job.index + 1}-${screen.title}.png`,
      source: 'layout', metadata: { screenIndex: job.index, sourceId: source.id } });
  }
  return async function execute(job) {
    const taskProviders = providers.forModel?.(job.modelEntryId) || providers;
    const project = job.snapshot;
    save(job, { status: 'running', error: '', startedAt: job.startedAt || new Date().toISOString() });
    try {
      if (!job.upstreamId && !job.resultUrls?.length && !job.sourceId) await license?.requireActive({ online: true });
      if (job.kind === 'layout') {
        const source = store.list('assets', a => a.projectId === project.id && a.kind === 'detail_source' && a.screenIndex === job.index)[0];
        assert(source, '没有可用的配图，请先生成该屏图片。');
        const asset = await makeDetail(job, source);
        save(job, { outputIds: [asset.id], stage: 'done', status: 'succeeded' }); return;
      }
      if (['product_analysis', 'reference_analysis'].includes(job.kind)) {
        save(job, { stage: 'submitting' });
        const result = job.kind === 'product_analysis' ? await analyzeProduct(project, taskProviders, media, store) : await analyzeReference(project, taskProviders, media, store);
        save(job, { result, status: 'succeeded', stage: 'done' }); return;
      }
      if (['main_image', 'detail_image', 'text_image'].includes(job.kind)) {
        if (!job.resultUrls?.length) {
          const screen = project.plan.screens[job.index];
          const prompt = job.prompt || (job.kind === 'detail_image' ? screen.prompt : `电商商品主图，专业摄影，干净背景，真实光线和材质，商品轮廓、颜色、Logo与参考保持一致。${project.fields.brief}`);
          const inputImage = job.kind === 'text_image' ? undefined : await media.imageData(store.require('assets', project.imageId));
          save(job, { stage: 'submitting' });
          const result = await taskProviders.image({ prompt, image: inputImage, aspect: job.kind === 'detail_image' ? '3:4' : '1:1' });
          save(job, { resultUrls: result.urls, requestId: result.requestId, usage: result.usage, stage: 'saving' });
        }
        let source = job.sourceId && store.get('assets', job.sourceId);
        if (!source) {
          source = await media.captureRemote(job.resultUrls[0], { projectId: project.id, jobId: job.id,
            kind: job.kind === 'detail_image' ? 'detail_source' : job.kind, name: `${job.label}.png`, source: 'ai', metadata: { screenIndex: job.index } });
          save(job, { sourceId: source.id });
        }
        const output = job.kind === 'detail_image' ? await makeDetail(job, source) : source;
        save(job, { outputIds: [output.id], status: 'succeeded', stage: 'done' }); return;
      }
      if (!job.upstreamId) {
        const image = await media.imageData(store.require('assets', project.imageId));
        let input;
        if (job.kind === 'replica_video') {
          input = { video: await media.videoData(store.require('assets', project.referenceId)), images: [image],
            prompt: job.prompt || `以参考视频的叙事和节奏制作自有商品广告，替换为商品图片中的商品，保留其外观。不复制原品牌标志。${project.fields.brief}` };
        } else {
          const video = project.plan.videos[job.index];
          input = { image, prompt: job.prompt || `制作${job.duration}秒商品介绍视频，商品保持参考图外观。开头：${video.hook}。${video.shots.map(s => `${s.time} ${s.action} 字幕${s.caption}`).join('；')}。口播：${video.voiceover}。结尾：${video.cta}。${project.fields.brief}`,
            duration: job.duration, audio: job.audio };
        }
        save(job, { stage: 'submitting' });
        const upstreamId = job.kind === 'replica_video' ? await taskProviders.startReplica(input) : await taskProviders.startVideo(input);
        save(job, { upstreamId, stage: 'polling' });
      }
      if (!job.resultUrls?.length) {
        let completed = false;
        for (let n = 0; n < maxPolls; n++) {
          const result = await taskProviders.poll(job.provider, job.upstreamId);
          if (result.state === 'failed') throw new AppError('供应商生成失败，请检查素材与账号后重试。', 502, 'PROVIDER_REJECTED');
          if (result.state === 'succeeded') {
            assert(result.urls.length, '任务成功但没有可下载结果，请到供应商核对。', 502, 'PROVIDER_EMPTY');
            save(job, { resultUrls: result.urls, usage: result.usage, stage: 'saving' }); completed = true; break;
          }
          await new Promise(resolve => setTimeout(resolve, pollMs));
        }
        if (!completed) throw new AppError('任务仍在供应商处理中，可稍后继续查询。', 504, 'POLL_TIMEOUT');
      }
      const result = await media.captureRemote(job.resultUrls[0], { projectId: project.id, jobId: job.id, kind: job.kind, name: `${job.label}.mp4`, source: 'ai' });
      save(job, { outputIds: [result.id], stage: 'done', status: 'succeeded' });
    } catch (error) {
      const uncertain = ['PROVIDER_UNCERTAIN', 'POLL_TIMEOUT', 'PROVIDER_EMPTY'].includes(error.code) || Boolean(job.upstreamId && !['PROVIDER_REJECTED'].includes(error.code));
      save(job, { status: uncertain ? 'needs_review' : 'failed',
        error: error instanceof AppError ? error.message : '处理未完成，请检查素材后重试。', errorCode: error.code || 'PROCESS_FAILED' });
    } finally { save(job, { finishedAt: new Date().toISOString() }); }
  };
}
