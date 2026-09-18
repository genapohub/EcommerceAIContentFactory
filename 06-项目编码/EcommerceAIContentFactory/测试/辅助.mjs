import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { createApplication } from '../服务端/应用.mjs';
export async function fixtureMedia(directory) {
  const image = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#d6e4dc' } }).png().toBuffer();
  const videoPath = path.join(directory, '接口测试片.mp4');
  await promisify(execFile)(ffmpeg, ['-v','error','-y','-f','lavfi','-i','testsrc=size=320x240:rate=12','-t','5','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',videoPath], { windowsHide:true });
  return { image, video: await readFile(videoPath) };
}
export async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'factory-test-'));
  const media = await fixtureMedia(directory);
  const calls = { image:0, start:0, poll:0, replica:0 };
  const providers = {
    image: async () => { calls.image++; return { urls:['https://fixture.example/image'],requestId:'test-image' }; },
    startVideo: async () => { calls.start++; return 'test-video'; },
    startReplica: async () => { calls.replica++; return 'test-replica'; },
    poll: async () => { calls.poll++; return { state:'succeeded',urls:['https://fixture.example/video'] }; },
    ...options.providers,
  };
  const application = createApplication({ dataDir:directory,env:{},pollMs:1,maxPolls:3,providers,
    license: { requireActive: async () => {}, status: async () => ({ authorized: true }) },
    downloader:async url=>({ bytes:url.endsWith('video')?media.video:media.image,contentType:url.endsWith('video')?'video/mp4':'image/png',url }), ...options });
  const server = application.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=(await (await fetch(base+'/api/v1/session')).json()).token;
  async function request(route,method='GET',body,extra={}) {
    const response = await fetch(base+'/api/v1'+route,{method,headers:{'X-Factory-Token':token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...extra},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
    return { status:response.status,data,headers:response.headers };
  }
  t.after(async()=>{await application.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  return { ...application, directory, mediaFixture:media, calls, base, request,token };
}
export async function readyProject(a) {
  a.config.save({wanKey:'test-only-wan',viduKey:'test-only-vidu',viduBillingConfirmed:true});
  const p=a.projects.create({fields:{name:'接口验收商品',claims:'可见的提手设计'}});
  return a.projects.upload(p.id,a.mediaFixture.image,{kind:'product',name:'测试照片.png'});
}
export async function settle(a, ids) {
  for(let n=0;n<400;n++) {
    const jobs=ids.map(id=>a.store.get('jobs',id));
    if(jobs.every(j=>!['running','queued'].includes(j.status)))return jobs;
    await new Promise(r=>setTimeout(r,20));
  }
  throw new Error('测试任务未在8秒内结束');
}
