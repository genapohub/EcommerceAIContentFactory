import { z } from 'zod';
import { createHash } from 'node:crypto';
import { assert } from './错误.mjs';
import { taskCapability } from './模型目录.mjs';

export const requestSchema = z.object({
  projectId: z.string().uuid(),
  tasks: z.array(z.object({ kind: z.enum(['main_image', 'text_image', 'detail_image', 'intro_video', 'replica_video', 'product_analysis', 'reference_analysis', 'layout']),
    index: z.number().int().min(0).max(7).default(0), prompt: z.string().max(1800).default(''),
    duration: z.number().int().min(2).max(15).default(10), audio: z.boolean().default(true) })).min(1).max(16),
});

export function quoteTasks(store, config, input) {
  const parsed = requestSchema.parse(input);
  const project = store.require('projects', parsed.projectId);
  const settings = config.public();
  const image = project.imageId && store.get('assets', project.imageId);
  const reference = project.referenceId && store.get('assets', project.referenceId);
  const tasks = parsed.tasks.map(task => {
    const provider = task.kind === 'replica_video' ? 'vidu' : 'wan';
    const blocks = [];
    let model;
    if (task.kind !== 'layout') {
      try { model = config.models.resolve(taskCapability[task.kind]); }
      catch (error) { blocks.push(error.message); }
    }
    if (!['text_image', 'reference_analysis', 'layout'].includes(task.kind) && !image) blocks.push('缺少商品图片');
    if (['replica_video', 'reference_analysis'].includes(task.kind) && !reference) blocks.push('缺少可读取的参考视频');
    if (task.kind === 'text_image' && !task.prompt.trim()) blocks.push('请输入图片描述');
    if (['detail_image', 'layout'].includes(task.kind) && !project.plan.screens[task.index]) blocks.push('详情屏不存在');
    if (task.kind === 'intro_video' && !project.plan.videos[task.index]) blocks.push('视频方案不存在');
    if (task.kind === 'replica_video' && !settings.viduBillingConfirmed) blocks.push('请先确认Vidu账号计费口径');
    if (task.kind === 'replica_video' && reference && reference.duration < 5) blocks.push('复刻参考视频至少需要5秒');
    if (['main_image', 'detail_image', 'intro_video', 'replica_video'].includes(task.kind) && image && Math.min(image.width, image.height) < 240) blocks.push('生成用商品图片短边至少240像素');
    if (task.kind === 'layout' && !store.list('assets', a => a.projectId === project.id && a.kind === 'detail_source' && a.screenIndex === task.index).length) blocks.push('该屏尚无已生成配图');
    const estimate = task.kind === 'intro_video' ? task.duration * (task.audio ? 0.30 : 0.15)
      : task.kind === 'replica_video' ? (reference?.duration || 0) * settings.viduSecondYuan
      : ['product_analysis', 'reference_analysis'].includes(task.kind) ? null : task.kind === 'layout' ? 0 : 0.2;
    return { ...task, provider, modelEntryId: model?.id, modelRevision: model?.revision, estimate: estimate === null ? null : Math.round(estimate * 100) / 100, blocks };
  });
  const total = Math.round(tasks.reduce((sum, task) => sum + (task.estimate || 0), 0) * 100) / 100;
  const hash = createHash('sha256').update(JSON.stringify({ project, tasks, max: settings.maxTaskYuan })).digest('hex');
  assert(total <= settings.maxTaskYuan, `本批预估¥${total}，超过设置的单批预算¥${settings.maxTaskYuan}。`, 409, 'BUDGET_EXCEEDED');
  return { projectId: project.id, tasks, total, hash, note: '估算不含重试。分析按实际Token计费；Vidu按你确认的参考时长费率估算，最终以供应商账单为准。' };
}
