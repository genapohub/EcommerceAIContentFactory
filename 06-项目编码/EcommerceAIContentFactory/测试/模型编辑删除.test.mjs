import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './辅助.mjs';
import { createConfig } from '../服务端/配置.mjs';

test('仅未启用模型可删除，删除持久化且不影响其他配置', async t => {
  const a = await setup(t, { startJobs: false });
  const m = a.config.models.save({ name: '待删模型', templateId: 'qwen-plus', apiKey: 'unit-only', enabled: true });
  assert.equal((await a.request(`/config/models/${m.id}`, 'DELETE')).status, 409);
  a.config.models.save({ enabled: false }, m.id);
  assert.equal((await a.request(`/config/models/${m.id}`, 'DELETE')).status, 200);
  assert.equal(a.config.models.list().some(x => x.id === m.id), false);
  assert.throws(() => a.config.models.require(m.id), /不存在/);
  assert.equal(createConfig(a.store, {}).models.list().some(x => x.id === m.id), false);
  assert.ok(a.config.models.list().length);
});

test('未启用模型有关联运行或待核对任务时拒绝删除', async t => {
  const a = await setup(t, { startJobs: false });
  const m = a.config.models.save({ name: '待删模型', templateId: 'qwen-plus' });
  for (const status of ['queued', 'running', 'needs_review']) {
    const job = a.store.save('jobs', { modelEntryId: m.id, status });
    assert.throws(() => a.config.models.remove(m.id), { code: 'MODEL_BUSY' });
    a.store.remove('jobs', job.id);
  }
  let finish;
  a.config.models.save({ apiKey: 'test-only' }, m.id);
  const checking = a.config.models.check(m.id, () => new Promise(resolve => { finish = resolve; }));
  assert.throws(() => a.config.models.remove(m.id), { code: 'MODEL_BUSY' });
  finish({ data: [] }); await checking;
  assert.equal(a.config.models.remove(m.id).deleted, true);
});

test('编辑可切换同厂商模型并保留密钥，跨厂商不会携带旧密钥', async t => {
  const a = await setup(t, { startJobs: false });
  const m = a.config.models.save({ name: '编辑模型', templateId: 'qwen-plus', apiKey: 'wan-only', workspaceId: 'workspace-a', enabled: true });
  const response = await a.request(`/config/models/${m.id}`, 'PATCH', { templateId: 'qwen-flash' });
  assert.equal(response.status, 200); assert.equal(response.data.model, 'qwen3-vl-flash'); assert.equal(response.data.hasKey, true);
  assert.throws(() => a.config.models.save({ templateId: 'vidu-replica' }, m.id), { code: 'MISSING_CONFIG' });
  assert.equal(a.config.models.require(m.id).templateId, 'qwen-flash');
  const next = a.config.models.save({ templateId: 'vidu-replica', enabled: false }, m.id);
  assert.equal(next.hasKey, false); assert.equal(next.workspaceId, '');
  assert.throws(() => a.config.models.resolve('replica', m.id), { code: 'MISSING_CONFIG' });
});

test('有可恢复任务时不能更换模型类型，允许更新失败任务的密钥', async t => {
  const a = await setup(t, { startJobs: false });
  const m = a.config.models.save({ name: '视频', templateId: 'wan-video', apiKey: 'test-only' });
  a.store.save('jobs', { modelEntryId: m.id, status: 'failed', upstreamId: 'pending-upstream' });
  assert.throws(() => a.config.models.save({ templateId: 'vidu-replica' }, m.id), { code: 'MODEL_BUSY' });
  assert.equal(a.config.models.save({ apiKey: 'replacement-test-key' }, m.id).hasKey, true);
});
