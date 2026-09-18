import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../服务端/存储.mjs';
import { createConfig } from '../服务端/配置.mjs';
import { createProviders } from '../服务端/模型适配.mjs';
import { createApplication } from '../服务端/应用.mjs';
import { quoteTasks } from '../服务端/报价.mjs';
import { draftPlan } from '../服务端/项目.mjs';

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'factory-models-'));
  const store = createStore(directory); const config = createConfig(store, {});
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  return { store, config, directory };
}

test('模型按新增和更新时间倒序，编辑后置顶且重启保持顺序', async t => {
  const { config, directory } = await setup(t);
  const first = config.models.save({ name: '先新增', templateId: 'qwen-plus' });
  const second = config.models.save({ name: '后新增', templateId: 'wan-text' });
  assert.equal(config.models.list()[0].id, second.id);
  const updated = config.models.save({ name: '编辑过的模型' }, first.id);
  assert.equal(config.models.list()[0].id, first.id);
  assert.equal(updated.createdAt, first.createdAt);
  assert.ok(updated.updatedAt > second.updatedAt);
  const reopened = createStore(directory);
  try { assert.equal(createConfig(reopened, {}).models.list()[0].id, first.id); }
  finally { reopened.close(); }
});

test('旧模型没有时间戳时按原记录倒序，编辑后记录真实更新时间', async t => {
  const { config } = await setup(t);
  const old = config.models.list().at(-1);
  assert.equal(old.createdAt, undefined);
  const updated = config.models.save({ name: '已维护的历史配置' }, old.id);
  assert.equal(updated.createdAt, null);
  assert.ok(updated.updatedAt);
  assert.equal(config.models.list()[0].id, old.id);
});
test('新增模型、同能力启用切换、配置持久化且密钥不落盘', async t => {
  const { store, config, directory } = await setup(t);
  const model = config.models.save({ name: '独立文生图', templateId: 'wan-text', apiKey: 'private-model-key', enabled: true });
  assert.equal(model.hasKey, true);
  assert.equal(config.models.list().filter(m => m.enabled && m.capability === 'text_image').length, 1);
  assert.equal(config.models.resolve('text_image').id, model.id);
  assert.equal(JSON.stringify(config.public()).includes('private-model-key'), false);
  assert.equal(JSON.stringify(store.list('settings')).includes('private-model-key'), false);
  const reopened = createStore(directory); const restored = createConfig(reopened, {});
  assert.equal(restored.models.require(model.id).enabled, true); assert.equal(restored.models.require(model.id).hasKey, false); reopened.close();
  config.models.save({ enabled: false }, model.id); assert.throws(() => config.models.resolve('text_image'), /没有已启用/);
});
test('禁用模型阻止对应能力报价，文生图不依赖商品原图', async t => {
  const { store, config } = await setup(t);
  const model = config.models.save({ name:'文生图', templateId:'wan-text', apiKey:'test-key', enabled:true });
  const project = store.save('projects', { fields:{},plan:draftPlan(),imageId:null,referenceId:null });
  const input = { projectId:project.id,tasks:[{kind:'text_image',prompt:'白色背景'}] };
  const quote = quoteTasks(store,config,input); assert.deepEqual(quote.tasks[0].blocks,[]);assert.equal(quote.tasks[0].modelEntryId,model.id);
  config.models.save({ enabled:false },model.id); assert.match(quoteTasks(store,config,input).tasks[0].blocks.join(','),/没有已启用/);
});
test('连接测试记录状态、耗时、时间，Vidu不伪报连通', async t => {
  const { config } = await setup(t);
  const wan = config.models.save({ name:'测试',templateId:'wan-image',apiKey:'test-key' });
  let called = 0;
  const good = await config.models.check(wan.id,async url=>{called++;assert.match(url,/compatible-mode\/v1\/models$/);return {data:[]};});
  assert.equal(good.check.status,'reachable');assert.ok(good.check.checkedAt);assert.equal(called,1);
  config.models.save({enabled:false},wan.id);assert.equal(config.models.require(wan.id).check.status,'reachable');
  const failed = await config.models.check(wan.id,async()=>{throw new Error('test-key internal details');});
  assert.equal(failed.check.status,'failed');assert.equal(JSON.stringify(failed).includes('test-key'),false);
  const vidu = config.models.save({name:'复刻',templateId:'vidu-replica',apiKey:'vidu-test'});
  const result = await config.models.check(vidu.id,async()=>{throw new Error('should not call');});assert.equal(result.check.status,'unverified');
});
test('绑定任务使用原模型密钥与业务空间，禁用不影响已提交任务轮询', async t => {
  const { config, store } = await setup(t);
  const first = config.models.save({name:'视频A',templateId:'wan-video',apiKey:'key-a',workspaceId:'space-a',enabled:true});
  const calls=[]; const providers=createProviders(config,async(url,options)=>{calls.push({url,...options});return {output:{task_status:'RUNNING'}};});
  store.save('jobs',{modelEntryId:first.id,status:'running'});
  assert.throws(()=>config.models.save({apiKey:'changed'},first.id),/运行中的任务/);
  config.models.save({name:'视频B',templateId:'wan-video',apiKey:'key-b',workspaceId:'space-b',enabled:true});
  assert.equal(config.models.require(first.id).enabled,false);
  await providers.forModel(first.id).poll('wan','task-a');assert.match(calls[0].url,/space-a/);assert.equal(calls[0].headers.Authorization,'Bearer key-a');
});
test('修改接入参数后，不采纳旧连接请求的测试结果',async t=>{
  const {config}=await setup(t);const model=config.models.save({name:'测试',templateId:'qwen-plus',apiKey:'old-key'});
  let finish; const pending=config.models.check(model.id,()=>new Promise(resolve=>{finish=resolve;}));
  config.models.save({apiKey:'new-key'},model.id);finish({data:[]});await pending;
  assert.equal(config.models.require(model.id).check.status,'untested');
});
test('新增、编辑、测试连接HTTP契约与参数验证',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'factory-model-api-'));
  const app=createApplication({dataDir:directory,env:{},startJobs:false,providerRequest:async()=>({data:[]})});
  const server=app.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await app.close();await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;const {token}=await(await fetch(base+'/session')).json();
  const call=(route,method,body)=>fetch(base+route,{method,headers:{'X-Factory-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const create=await call('/config/models','POST',{name:'API模型',templateId:'wan-text',apiKey:'api-test',enabled:true});assert.equal(create.status,201);const model=await create.json();
  assert.equal((await call(`/config/models/${model.id}`,'PATCH',{enabled:false})).status,200);
  assert.equal((await(await call(`/config/models/${model.id}/check`,'POST',{})).json()).check.status,'reachable');
  assert.equal((await call('/config/models','POST',{name:'外部',templateId:'unsupported',apiKey:'x'})).status,400);
});
