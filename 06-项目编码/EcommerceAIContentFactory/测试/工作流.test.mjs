import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { setup, readyProject, settle } from './辅助.mjs';
import { AppError } from '../服务端/错误.mjs';
import { createStore } from '../服务端/存储.mjs';
import { createConfig } from '../服务端/配置.mjs';
import { createJobs } from '../服务端/任务.mjs';

test('空资料可保存，五类商品结构完整，密钥不落盘、不回传', async t=>{
  const a=await setup(t);
  assert.equal((await a.request('/projects','POST',{})).status,201);
  for(const category of ['服饰','美妆','食品','家居','3C']) {
    const p=a.projects.create({fields:{category}}); assert.equal(p.plan.screens.length,6);assert.equal(p.plan.videos.length,3);assert.equal(p.plan.points.length,0);
  }
  const result=await a.request('/config','PUT',{wanKey:'secret-test-unique',maxTaskYuan:10});
  assert.equal(result.data.hasWanKey,true);assert.equal(JSON.stringify(result.data).includes('secret-test-unique'),false);
  const second=createStore(a.directory);assert.equal(JSON.stringify(second.list('settings')).includes('secret-test-unique'),false);
  assert.equal(createConfig(second,{}).public().hasWanKey,false);assert.equal(second.list('projects').length,6);second.close();
});

test('文件真实类型校验，错误素材不留记录，链接导入读取视频',async t=>{
  const a=await setup(t);const p=a.projects.create();
  await assert.rejects(a.projects.upload(p.id,Buffer.from('fake png'),{kind:'product',name:'fake.png'}));
  await assert.rejects(a.projects.upload(p.id,a.mediaFixture.image,{kind:'reference',name:'fake.mp4'}));
  assert.equal(a.store.list('assets').length,0);
  const input=new FormData();input.append('kind','product');input.append('file',new Blob([a.mediaFixture.image],{type:'image/png'}),'照片.png');
  const result=await a.request(`/projects/${p.id}/assets`,'POST',input);assert.equal(result.status,201);assert.ok(result.data.imageId);
  const linked=await a.request(`/projects/${p.id}/reference`,'POST',{url:'https://fixture.example/video'});
  assert.equal(linked.status,201);assert.ok(linked.data.assets.find(x=>x.kind==='reference').duration>=5);
});

test('费用确认、资料变化、预算与重复提交保护',async t=>{
  const a=await setup(t);const p=await readyProject(a);const body={projectId:p.id,tasks:[{kind:'intro_video',duration:10}]};
  const quote=a.jobs.quote(body);assert.equal(quote.total,3);
  a.projects.update(p.id,{fields:{...p.fields,name:'已更新'}});
  assert.throws(()=>a.jobs.create({...body,quoteHash:quote.hash},randomUUID()),/变化/);
  a.config.save({maxTaskYuan:1});assert.throws(()=>a.jobs.quote(body),/预算/);
  a.config.save({maxTaskYuan:100});const q=a.jobs.quote(body),key=randomUUID();
  const jobs=a.jobs.create({...body,quoteHash:q.hash},key);const repeated=a.jobs.create({...body,quoteHash:q.hash},key);
  assert.equal(jobs[0].id,repeated[0].id);assert.equal((await settle(a,jobs.map(j=>j.id)))[0].status,'succeeded');assert.equal(a.calls.start,1);
  const p2=a.projects.create();assert.throws(()=>a.jobs.create({...body,projectId:p2.id},key),/其他商品/);
});

test('主图、6屏、视频、复刻端到端文件落盘，长图/CSV/ZIP可导出',async t=>{
  const a=await setup(t);let p=await readyProject(a);p=await a.projects.upload(p.id,a.mediaFixture.video,{kind:'reference',name:'参考.mp4'});
  const body={projectId:p.id,tasks:[{kind:'main_image'},...p.plan.screens.map((_,index)=>({kind:'detail_image',index})),{kind:'intro_video'},{kind:'replica_video'}]};
  const q=a.jobs.quote(body);const jobs=a.jobs.create({...body,quoteHash:q.hash},randomUUID());const done=await settle(a,jobs.map(j=>j.id));
  assert.ok(done.every(j=>j.status==='succeeded'),JSON.stringify(done.map(j=>[j.kind,j.status,j.error])));
  const current=a.projects.detail(p.id);assert.equal(current.assets.filter(x=>x.source==='ai').length,9);
  assert.equal(current.jobs.some(j=>'resultUrls'in j||'snapshot'in j),false);
  const long=await a.request(`/projects/${p.id}/export?format=long-image`);assert.equal(long.status,200);
  const meta=await sharp(long.data).metadata();assert.equal(meta.width,900);assert.equal(meta.height,7200);
  const csv=await a.request(`/projects/${p.id}/export?format=csv`);assert.match(csv.data.toString(),/视频/);
  const zip=await a.request(`/projects/${p.id}/export?format=zip`);assert.equal(zip.data.subarray(0,2).toString(),'PK');
  const asset=current.assets.find(x=>x.kind==='intro_video');const range=await a.request(`/assets/${asset.id}`,'GET',undefined,{Range:'bytes=0-99'});assert.equal(range.status,206);assert.equal(range.data.length,100);
  assert.ok(asset.posterUrl);const poster=await a.request(`/assets/${asset.id}?poster=1`);assert.equal(poster.status,200);assert.equal((await sharp(poster.data).metadata()).format,'jpeg');
  const layoutBody={projectId:p.id,tasks:[{kind:'layout',index:0}]};const lq=a.jobs.quote(layoutBody);assert.equal(lq.total,0);
  const layout=a.jobs.create({...layoutBody,quoteHash:lq.hash},randomUUID());assert.equal((await settle(a,layout.map(j=>j.id)))[0].status,'succeeded');
});

test('供应商错误文件不能标为成功；续查不重新提交视频',async t=>{
  const a=await setup(t,{downloader:async url=>({bytes:Buffer.from('invalid result'),contentType:'video/mp4',url})});const p=await readyProject(a);
  const body={projectId:p.id,tasks:[{kind:'intro_video'}]};const q=a.jobs.quote(body);const jobs=a.jobs.create({...body,quoteHash:q.hash},randomUUID());
  const done=(await settle(a,jobs.map(j=>j.id)))[0];assert.equal(done.status,'needs_review');assert.deepEqual(done.outputIds,[]);
  a.jobs.retry(done.id);await settle(a,[done.id]);assert.equal(a.calls.start,1);
});

test('提交不确定时不自动重投，显式重试去重',async t=>{
  const a=await setup(t,{providers:{startVideo:async()=>{throw new AppError('连接中断',502,'PROVIDER_UNCERTAIN');}}});const p=await readyProject(a);
  const body={projectId:p.id,tasks:[{kind:'intro_video'}]};const q=a.jobs.quote(body);const jobs=a.jobs.create({...body,quoteHash:q.hash},randomUUID());
  const done=(await settle(a,jobs.map(j=>j.id)))[0];assert.equal(done.status,'needs_review');assert.throws(()=>a.jobs.retry(done.id),/新费用/);
  const first=a.jobs.retry(done.id,{acknowledgeCharge:true});const second=a.jobs.retry(done.id,{acknowledgeCharge:true});assert.equal(first.id,second.id);await settle(a,[first.id]);
});

test('重启仅恢复有编号的任务；提交中无编号转人工核对',async t=>{
  const a=await setup(t,{startJobs:false});const p=await readyProject(a);
  const base={projectId:p.id,snapshot:a.store.get('projects',p.id),kind:'intro_video',provider:'wan',index:0,label:'重启测试',status:'running',outputIds:[]};
  const polling=a.store.save('jobs',{...base,upstreamId:'existing-task',stage:'polling'});
  const unknown=a.store.save('jobs',{...base,stage:'submitting'});
  const resumed=createJobs({store:a.store,config:a.config,media:a.media,providers:a.providers,pollMs:1,maxPolls:2});resumed.start();
  const done=await settle(a,[polling.id,unknown.id]);assert.equal(done[0].status,'succeeded');assert.equal(done[1].status,'needs_review');assert.equal(a.calls.start,0);await resumed.stop();
});
