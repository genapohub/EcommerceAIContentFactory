import { randomUUID } from 'node:crypto';
import { quoteTasks } from './报价.mjs';
import { assert } from './错误.mjs';
import { planSchema } from './项目.mjs';
import { taskCapability } from './模型目录.mjs';
import { createExecutor } from './任务执行.mjs';

const labels = { main_image: '商品主图', text_image: '创意图片', detail_image: '分屏详情', intro_video: '介绍视频', replica_video: '参考视频复刻', product_analysis: '商品AI分析', reference_analysis: '参考视频分析', layout: '详情重新排版' };
export function createJobs(options) {
  const { store, config } = options;
  const execute = createExecutor(options);
  let active = 0; let closed = false;
  const running = new Set();
  const promises = new Set();
  function publicJob({ snapshot, resultUrls, ...job }) { return job; }
  function drain() {
    if (closed) return;
    for (const candidate of store.list('jobs').reverse().filter(j => j.status === 'queued')) {
      if (active >= 2) break;
      if (running.has(candidate.id)) continue;
      active++; running.add(candidate.id);
      const promise = execute(candidate).finally(() => { active--; running.delete(candidate.id); promises.delete(promise); drain(); });
      promises.add(promise);
    }
  }
  function list() { return store.list('jobs').map(publicJob); }
  for (const job of store.list('jobs')) {
    if (job.status === 'running') store.save('jobs', { ...job,
      status: job.upstreamId || job.resultUrls?.length || job.stage !== 'submitting' ? 'queued' : 'needs_review',
      error: '服务已重启；有上游编号的任务将继续查询，不重复提交。' });
  }
  return {
    list,
    start: drain,
    stop: async () => { closed = true; await Promise.allSettled([...promises]); },
    quote: input => quoteTasks(store, config, input),
    create(input, idempotencyKey) {
      assert(typeof idempotencyKey === 'string' && idempotencyKey.length >= 10 && idempotencyKey.length < 100, '缺少有效的提交标识。');
      const previous = store.list('jobs', j => j.batchId === idempotencyKey);
      if (previous.length) {
        assert(previous.every(j => j.projectId === input.projectId), '提交标识已用于其他商品，请刷新后重试。', 409);
        return previous.map(publicJob);
      }
      const quote = quoteTasks(store, config, input);
      assert(input.quoteHash === quote.hash, '商品资料或费用已变化，请重新查看预估。', 409, 'QUOTE_CHANGED');
      assert(quote.tasks.every(task => !task.blocks.length), quote.tasks.flatMap(t => t.blocks).join('；'), 409, 'TASK_BLOCKED');
      const snapshot = store.require('projects', quote.projectId);
      const jobs = quote.tasks.map(task => store.save('jobs', { ...task, id: randomUUID(), projectId: snapshot.id, projectName: snapshot.fields.name || '未命名商品',
        batchId: idempotencyKey, snapshot, label: labels[task.kind] + (['detail_image', 'intro_video', 'layout'].includes(task.kind) ? ` ${task.index + 1}` : ''),
        status: 'queued', stage: 'preparing', outputIds: [], error: '' }));
      queueMicrotask(drain);
      return jobs.map(publicJob);
    },
    retry(id, { acknowledgeCharge = false } = {}) {
      const job = store.require('jobs', id);
      assert(['failed', 'needs_review'].includes(job.status), '任务当前不可重试。', 409);
      if (job.resultUrls?.length || (job.upstreamId && job.errorCode !== 'PROVIDER_REJECTED')) {
        if (job.upstreamId) {
          if (job.modelEntryId) config.models.resolve(taskCapability[job.kind], job.modelEntryId); else config.key(job.provider);
        }
        store.save('jobs', { ...job, resultUrls: job.upstreamId ? undefined : job.resultUrls, status: 'queued', error: '' }); queueMicrotask(drain); return publicJob(store.get('jobs', id));
      }
      assert(acknowledgeCharge, '重新生成可能产生新费用，请确认后再提交。', 409, 'RETRY_CONFIRM');
      const repeated = store.list('jobs', j => j.retryOf === id && ['queued', 'running'].includes(j.status));
      if (repeated.length) return publicJob(repeated[0]);
      if (job.kind !== 'layout') {
        if (job.modelEntryId) {
          const model = config.models.resolve(taskCapability[job.kind], job.modelEntryId);
          assert(model.enabled, '此模型已禁用，请先启用再重新提交。', 409);
        } else config.key(job.provider);
      }
      const settings = config.public();
      if (job.kind === 'replica_video') assert(settings.viduBillingConfirmed, '请先确认Vidu计费口径。', 409);
      const estimate = job.kind === 'replica_video' ? Math.round(store.require('assets', job.snapshot.referenceId).duration * settings.viduSecondYuan * 100) / 100 : job.estimate;
      assert((estimate || 0) <= settings.maxTaskYuan, '当前预算不足，请调整预算后再重试。', 409, 'BUDGET_EXCEEDED');
      const replacement = store.save('jobs', { ...job, estimate, id: randomUUID(), batchId: randomUUID(), retryOf: id,
        status: 'queued', stage: 'preparing', createdAt: undefined, startedAt: undefined, finishedAt: undefined,
        error: '', errorCode: '', upstreamId: undefined, resultUrls: undefined, outputIds: [] });
      queueMicrotask(drain); return publicJob(replacement);
    },
    applyAnalysis(id) {
      const job = store.require('jobs', id);
      assert(job.status === 'succeeded' && job.result && ['product_analysis', 'reference_analysis'].includes(job.kind), '此任务没有可应用的分析。');
      const project = store.require('projects', job.projectId);
      const plan = job.kind === 'reference_analysis' ? { ...project.plan, reference: job.result } : {
        ...job.result, points: [...project.plan.points.filter(p => p.locked), ...job.result.points.filter(p => !project.plan.points.some(old => old.locked && old.id === p.id))],
        reference: project.plan.reference,
      };
      return store.save('projects', { ...project, plan: planSchema.parse(plan) });
    },
  };
}
