import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { validateRemote, isPublicAddress } from '../服务端/网络.mjs';
import { createProviders } from '../服务端/模型适配.mjs';
import { fitText } from '../服务端/排版.mjs';
import { planCsv } from '../服务端/导出.mjs';
import { draftPlan, checkContent } from '../服务端/项目.mjs';
import { setup } from './辅助.mjs';
import { acquireInstance } from '../服务端/实例锁.mjs';

test('拒绝本机/内网/凭据URL与混合DNS解析',async()=>{
  for(const url of ['http://127.0.0.1/a','http://10.0.0.1/a','http://[::1]/','http://169.254.169.254/','file:///test','https://u:p@example.com/','https://example.com:4000/'])await assert.rejects(validateRemote(url));
  await assert.rejects(validateRemote('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
  assert.equal(isPublicAddress('2002:7f00:1::'),false);assert.equal(isPublicAddress('8.8.8.8'),true);
});
test('接口要求会话，拒绝跨站来源和异常Host，媒体保护生效',async t=>{
  const a=await setup(t);assert.equal((await fetch(a.base+'/api/v1/projects')).status,401);
  assert.equal((await fetch(a.base+'/api/v1/session',{headers:{Origin:'https://evil.example'}})).status,403);
  const invalidHost = await new Promise((resolve,reject)=>http.get(a.base+'/api/v1/session',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(invalidHost,403);
  const page=await fetch(a.base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  for(const route of ['/工作台.html','/static/样式.css','/static/应用.js','/vendor/lucide/lucide.js'])assert.equal((await fetch(a.base+route)).status,200,route);
});
test('万相与Vidu请求契约、异步编号、轮询和视觉JSON解析',async()=>{
  const calls=[];
  const config={key:()=> 'test-only-key',wanBase:()=> 'https://dashscope.aliyuncs.com',get:()=>({visionModel:'qwen3-vl-plus'})};
  const adapter=createProviders(config,async(url,options)=>{
    calls.push({url,...options,body:options.body?JSON.parse(options.body):undefined});
    if(url.includes('multimodal-generation'))return {output:{choices:[{message:{content:[{image:'https://example.com/image.png'}]}}]},request_id:'image-id'};
    if(url.includes('video-synthesis'))return {output:{task_id:'wan-id'}};
    if(url.endsWith('trending-replicate'))return {task_id:'vidu-id'};
    if(url.includes('/creations'))return {state:'success',creations:[{url:'https://example.com/video.mp4'}]};
    if(url.includes('/tasks/'))return {output:{task_status:'SUCCEEDED',video_url:'https://example.com/video.mp4'}};
    return {choices:[{message:{content:'{"hook":"开头"}'}}]};
  });
  await adapter.image({prompt:'商品',image:'data:image/jpeg;base64,AAA'});assert.equal(calls.at(-1).body.model,'wan2.6-image');assert.equal(calls.at(-1).body.parameters.enable_interleave,false);
  await adapter.image({prompt:'场景'});assert.equal(calls.at(-1).body.model,'wan2.6-t2i');
  assert.equal(await adapter.startVideo({image:'data:image/jpeg;base64,AAA',prompt:'展示'}),'wan-id');assert.equal(calls.at(-1).headers['X-DashScope-Async'],'enable');
  assert.equal(await adapter.startReplica({video:'data:video/mp4;base64,BBB',images:['img'],prompt:'复刻'}),'vidu-id');assert.equal(calls.at(-1).headers.Authorization,'Token test-only-key');assert.equal(calls.at(-1).body.resolution,'720p');
  assert.equal((await adapter.poll('vidu','vidu-id')).state,'succeeded');assert.equal((await adapter.poll('wan','wan-id')).state,'succeeded');
  assert.equal((await adapter.understand({prompt:'分析',video:'data:video/mp4;base64,BBB'})).hook,'开头');
});
test('长文案排版不丢字，CSV公式转义，风险表达识别',()=>{
  const text='商品细节'.repeat(125);const result=fitText(text,804,255,27);assert.equal(result.lines.join(''),text);assert.ok(result.lines.length*result.lineHeight<=255);
  const plan=draftPlan({name:'=HYPERLINK("unsafe")',claims:'全网最低，根治'});
  plan.videos[0].title='=SUM(1,2)';assert.ok(planCsv({plan}).includes("'=SUM"));
  const risks=checkContent({fields:{},plan});assert.deepEqual(risks.terms,['全网最低','根治']);
  const duplicate='这是一段用于检查重复文案的参考视频长句请不要直接照搬到自己的商品广告中';
  plan.videos[0].voiceover=duplicate;assert.equal(checkContent({fields:{referenceText:duplicate},plan}).copied,true);
});
test('同一目录只允许一个活跃服务，正常释放后可重新启动',async t=>{
  const a=await setup(t);const release=acquireInstance(a.directory);
  assert.throws(()=>acquireInstance(a.directory),/已有服务/);release();const again=acquireInstance(a.directory);again();
});
