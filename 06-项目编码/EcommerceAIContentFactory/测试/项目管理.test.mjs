import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { setup, readyProject } from './辅助.mjs';
import { createProjects } from '../服务端/项目.mjs';

test('项目重命名保留全部资料、已编辑方案与素材，拒绝空白名称', async t => {
  const a = await setup(t, { startJobs: false });
  const p = await readyProject(a);
  const response = await a.request(`/projects/${p.id}/name`, 'PATCH', { name: '  新项目名称  ' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.fields, { ...p.fields, name: '新项目名称' });
  assert.deepEqual(response.data.plan, p.plan);
  assert.equal(response.data.imageId, p.imageId);
  assert.equal((await a.request(`/projects/${p.id}/name`, 'PATCH', { name: '   ' })).status, 400);
  assert.equal((await a.request(`/projects/${p.id}/name`, 'PATCH', { name: 'a'.repeat(101) })).status, 400);
});

test('删除项目级联清理素材文件和任务，不影响其他项目，最后列表为空', async t => {
  const a = await setup(t, { startJobs: false });
  const p = await readyProject(a), second = a.projects.create({ fields: { name: '保留项目' } });
  const asset = a.store.require('assets', p.imageId), filename = a.media.filename(asset);
  const job = a.store.save('jobs', { projectId: p.id, status: 'succeeded' });
  const otherJob = a.store.save('jobs', { projectId: second.id, status: 'succeeded' });
  const response = await a.request(`/projects/${p.id}`, 'DELETE');
  assert.equal(response.status, 200); assert.equal(response.data.cleanupPending, false);
  assert.equal((await a.request(`/projects/${p.id}`)).status, 404);
  assert.equal((await a.request(`/assets/${p.imageId}`)).status, 404);
  assert.equal(a.store.get('jobs', job.id), null);
  assert.ok(a.store.get('jobs', otherJob.id));
  assert.deepEqual(a.projects.list().map(p => p.id), [second.id]);
  await assert.rejects(access(filename), { code: 'ENOENT' });
  assert.equal((await a.request(`/projects/${p.id}`, 'DELETE')).status, 404);
  await a.projects.remove(second.id); assert.deepEqual(a.projects.list(), []);
});

test('运行中及待核对任务阻止删除，拒绝后项目素材与任务均保留', async t => {
  const a = await setup(t, { startJobs: false }); const p = await readyProject(a);
  for (const status of ['queued', 'running', 'needs_review']) {
    const job = a.store.save('jobs', { projectId: p.id, status });
    assert.equal((await a.request(`/projects/${p.id}`, 'DELETE')).status, 409);
    assert.ok(a.store.get('projects', p.id)); assert.ok(a.store.get('assets', p.imageId)); assert.ok(a.store.get('jobs', job.id));
    a.store.remove('jobs', job.id);
  }
});

test('导入素材期间不能删除，导入失败释放占用', async t => {
  const a = await setup(t, { startJobs: false }); const p = a.projects.create();
  let rejectImport;
  const projects = createProjects(a.store, { ...a.media, importUrl: () => new Promise((_, reject) => { rejectImport = reject; }) });
  const importing = projects.reference(p.id, 'https://example.com/video.mp4');
  const failed = assert.rejects(importing, /导入失败/);
  await assert.rejects(projects.remove(p.id), { code: 'PROJECT_BUSY' });
  rejectImport(new Error('导入失败')); await failed;
  assert.equal((await projects.remove(p.id)).deleted, true);
});

test('项目重命名与删除接口拒绝未认证请求', async t => {
  const a = await setup(t, { startJobs: false }); const p = a.projects.create();
  for (const [route, method] of [[`/projects/${p.id}/name`, 'PATCH'], [`/projects/${p.id}`, 'DELETE']]) {
    assert.equal((await a.request(route, method, { name: '非法修改' }, { 'X-Factory-Token': 'invalid' })).status, 401);
  }
  assert.equal(a.projects.list().length, 1);
});
