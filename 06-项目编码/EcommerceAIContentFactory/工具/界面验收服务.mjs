import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createApplication, root } from '../服务端/应用.mjs';
import { fixtureMedia } from '../测试/辅助.mjs';
import { renderScreen } from '../服务端/排版.mjs';

if (process.env.FACTORY_UI_TEST !== '1') throw new Error('仅用于隔离界面验收，请显式设置 FACTORY_UI_TEST=1');
const directory=path.join(root,'验收输出','界面测试数据');
await fs.mkdir(directory,{recursive:true});
const app=createApplication({dataDir:directory,env:{},startJobs:false});
if(!app.projects.list().length){
  const fixtures=await fixtureMedia(directory);
  const photo=await sharp(Buffer.from('<svg width="640" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="640" fill="#edf3ef"/><rect x="228" y="130" width="184" height="350" rx="28" fill="#9fbba9"/><rect x="238" y="105" width="164" height="50" rx="12" fill="#385b4b"/><rect x="242" y="280" width="156" height="108" rx="4" fill="white"/><text x="320" y="326" text-anchor="middle" font-family="Arial" font-size="19" fill="#385b4b">UI TEST</text><text x="320" y="356" text-anchor="middle" font-family="Arial" font-size="13" fill="#385b4b">NOT AI OUTPUT</text><text x="320" y="556" text-anchor="middle" font-family="Microsoft YaHei" font-size="18" fill="#385b4b">界面测试素材 / 非真实商品</text></svg>')).png().toBuffer();
  await fs.writeFile(path.join(directory,'界面测试商品.png'),photo);
  let project=app.projects.create({fields:{name:'界面验收样例（非AI成品）',category:'家居',claims:'用于验证图片排版，不用于商品宣传'}});
  project=await app.projects.upload(project.id,photo,{kind:'product',name:'界面测试商品.png'});
  await app.projects.upload(project.id,fixtures.video,{kind:'reference',name:'界面测试视频.mp4'});
  await app.media.save(photo,{projectId:project.id,kind:'main_image',source:'test',name:'主图展示测试.png'});
  for(let index=0;index<6;index++){
    const source=await app.media.save(photo,{projectId:project.id,kind:'detail_source',source:'test',name:'测试原图.png',metadata:{screenIndex:index}});
    const rendered=await renderScreen(app.media.filename(source),{...project.plan.screens[index],copy:'仅验证中文排版与导出。此图并非模型生成。'},index);
    await app.media.save(rendered,{projectId:project.id,kind:'detail_image',source:'test',name:`界面测试第${index+1}屏.png`,metadata:{screenIndex:index,sourceId:source.id}});
  }
  await app.media.save(fixtures.video,{projectId:project.id,kind:'intro_video',source:'test',name:'播放测试片（非AI生成）.mp4'});
}
app.app.listen(5299,'127.0.0.1',()=>console.log('隔离界面验收：http://127.0.0.1:5299/，所有成品为明确标记的测试素材。'));
