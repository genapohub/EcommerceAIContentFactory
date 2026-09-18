import { $, state as s, html as h, icons, connect, api, download, toast, on } from './接口.js';
import { labels, renderProduct, renderProjects, renderResults, renderJobs, renderConfig } from './渲染.js';
import { bindEditor, openEditor } from './编辑.js';
import { bindProjectManagement, projectManagementBusy } from './项目管理.js';
import { initializeAuthorization, lockWorkspace } from './账号授权.js';
let pending; let submitting = false; let polling = false;
function view(name) {
  s.view = name;
  for (const v of ['production','history','config','license']) $(`#${v}-view`).hidden = v !== name;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('#page-label').textContent = { production:'内容生产',history:'生成任务',config:'国内模型',license:'账号与设备' }[name];
  $('#page-title').textContent = { production:'商品内容生成',history:'任务与成品记录',config:'国内模型接入',license:'账号与设备' }[name];
  $('#save-project').hidden = name !== 'production'; $('#save-status').hidden = name !== 'production';
  if (name === 'history') renderJobs(); if (name === 'config') renderConfig();
}
async function projectList() { s.projects = await api('/projects'); renderProjects(); }
async function save() {
  if (!s.project || !s.dirty) return;
  const fields = Object.fromEntries(new FormData($('#product-form')));
  s.project = await api(`/projects/${s.project.id}`,{method:'PATCH',body:{fields}});
  s.dirty=false; $('#save-status').textContent='已保存'; await projectList();
}
async function selectProject(id) {
  await save(); s.project = await api(`/projects/${id}`); localStorage.setItem('factory-project',id);
  s.dirty=false; renderProduct(); view('production');
}
async function refreshJobs(force = false) {
  const jobs = await api('/jobs');
  if (projectManagementBusy() && !force) return;
  s.jobs = jobs; renderJobs();
  if (s.project && !s.dirty && !$('#editor-dialog').open) {
    const projectId = s.project.id;
    const latest = await api(`/projects/${projectId}`);
    if (s.project?.id !== projectId || s.dirty || projectManagementBusy() && !force) return;
    const changed = JSON.stringify(latest) !== JSON.stringify(s.project);
    s.project = latest; if (changed) renderResults();
  }
}
async function propose(tasks) {
  await save();
  const body={projectId:s.project.id,tasks}; const quote=await api('/quotes',{method:'POST',body});
  pending={...body,quoteHash:quote.hash,key:crypto.randomUUID()};
  $('#quote-content').innerHTML = quote.tasks.map(t=>`<div class="quote-item"><div class="row split"><span>${h(labels[t.kind])}${['detail_image','intro_video','layout'].includes(t.kind) ? ` ${t.index+1}` : ''}</span><b>${t.estimate===null ? '按Token计费' : `¥${t.estimate.toFixed(2)}`}</b></div>${t.blocks.map(b=>`<p class="risk">${h(b)}</p>`).join('')}</div>`).join('') + `<div class="quote-total">¥${quote.total.toFixed(2)} <small>本批预估${quote.tasks.some(t=>t.estimate===null) ? ' + 分析Token费用' : ''}</small></div><p class="muted">${h(quote.note)}</p>`;
  $('#confirm-generate').disabled=quote.tasks.some(t=>t.blocks.length); $('#task-dialog').showModal();
}
function introTask(index=s.videoIndex) {return {kind:'intro_video',index,duration:s.videoDuration,audio:s.videoAudio};}
function selectedTasks() {
  if(s.mode==='replica') return [{kind:'replica_video'}];
  return [...document.querySelectorAll('[name=target]:checked')].flatMap(input => input.value==='detail_image' ? s.project.plan.screens.map((_,index)=>({kind:'detail_image',index})) : input.value==='intro_video' ? [introTask()] : Array.from({length:s.imageCount},()=>({kind:'main_image'})));
}
function setMode(mode) {
  s.mode=mode; $('#reference-input').hidden=mode!=='replica'; $('#generation-options').hidden=mode==='replica';
  $('#generation-hint').textContent=mode==='replica' ? 'Vidu · 参考结构 + 自有商品' : '万相 · 商品原图生成';
  $('#generate').innerHTML=`<i data-lucide="sparkles"></i>${mode==='replica' ? '生成复刻视频' : '生成所选内容'}`;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  if(mode==='replica') s.output='videos'; renderResults();
}
async function upload(input,kind) {
  if(!input.files[0])return; const file=input.files[0]; input.value='';
  if(file.size>100*1024*1024)throw new Error('文件超过100MB，请压缩后上传');
  await save(); const form=new FormData(); form.append('kind',kind); form.append('file',file);
  toast('正在校验素材…'); s.project=await api(`/projects/${s.project.id}/assets`,{method:'POST',body:form}); renderProduct(); toast('素材已保存');
}
async function saveConfig() {
  const f=$('#config-form').elements;
  const body={wanKey:f.wanKey.value,viduKey:f.viduKey.value,workspaceId:f.workspaceId.value,visionModel:f.visionModel.value,viduSecondYuan:Number(f.viduSecondYuan.value),viduBillingConfirmed:f.viduBillingConfirmed.checked,maxTaskYuan:Number(f.maxTaskYuan.value)};
  s.config=await api('/config',{method:'PUT',body}); renderConfig(); renderResults();
}
async function action(target) {
  const a=target.dataset.action,index=Number(target.dataset.index||0),id=target.dataset.id;
  if(a==='new-project'){await save();s.project=await api('/projects',{method:'POST',body:{}});await projectList();renderProduct();view('production');return;}
  if(a==='config'||a==='history'){view(a);return;}
  if(a.startsWith('edit-')||a==='add-point'){await save();openEditor(a==='add-point'?'point':a.slice(5),a==='add-point'?s.project.plan.points.length:index);return;}
  if(a==='screen'||a==='layout')return propose([{kind:a==='screen'?'detail_image':'layout',index}]);
  if(a==='text-image'){await save();openEditor('text',0,prompt=>propose([{kind:'text_image',prompt}]));return;}
  if(a==='three-videos')return propose(s.project.plan.videos.map((_,i)=>introTask(i)));
  if(a==='long-image')return download(`/projects/${s.project.id}/export?format=long-image`,'商品详情长图.png');
  if(a==='open-project')return selectProject(id);
  if(a==='apply'){
    await save(); const job=s.jobs.find(j=>j.id===id);
    if(!confirm('应用此分析将更新目标商品的卖点、分屏和脚本（或参考结构）。已锁定卖点会保留，继续吗？'))return;
    const project=await api(`/jobs/${id}/apply`,{method:'POST',body:{}}); s.project=project; await projectList();renderProduct();view('production');s.output='plan';renderResults();toast(`${job.label}已应用`);return;
  }
  if(a==='retry') {
    const job=s.jobs.find(j=>j.id===id);
    const resume=job.upstreamId&&job.errorCode!=='PROVIDER_REJECTED'||job.sourceId||job.stage==='saving';
    if(!resume&&!confirm('将重新向供应商提交，可能再次产生费用。请先确认供应商后台没有可复用结果。是否继续？'))return;
    await api(`/jobs/${id}/retry`,{method:'POST',body:{acknowledgeCharge:!resume}});await refreshJobs();toast('任务已加入队列');
  }
}
async function init() {
  document.addEventListener('factory-models-changed', () => { if (s.project) renderResults(); });
  icons(); await connect(); $('#connection-alert').hidden=true;$('#service-status').textContent='本机服务已连接';
  s.config=await api('/config');
  const authorization = await initializeAuthorization(view);
  if (!authorization.authorized) { renderConfig(); lockWorkspace(view, renderConfig); return; }
  await projectList();
  const remembered=localStorage.getItem('factory-project');
  s.project=s.projects.length?await api(`/projects/${s.projects.find(p=>p.id===remembered)?.id||s.projects[0].id}`):null;
  bindProjectManagement({ save, selectProject, refreshJobs });
  await projectList();renderProduct();await refreshJobs();bindEditor();
  on('#product-form','submit',e=>e.preventDefault());
  on('#product-form','input',()=>{s.dirty=true;$('#save-status').textContent='未保存';});
  on('#save-project','click',async()=>{await save();toast('商品资料已保存');});
  on('#new-project','click',async()=>{await save();s.project=await api('/projects',{method:'POST',body:{}});await projectList();renderProduct();view('production');});
  on('#project-switch','change',e=>selectProject(e.target.value));
  on('#product-image','change',e=>upload(e.target,'product'));
  on('#reference-video','change',e=>upload(e.target,'reference'));
  on('#remove-image','click',async()=>{await save();s.project=await api(`/projects/${s.project.id}`,{method:'PATCH',body:{imageId:null}});renderProduct();});
  on('#import-link','click',async()=>{await save();toast('正在读取视频链接…');s.project=await api(`/projects/${s.project.id}/reference`,{method:'POST',body:{url:s.project.fields.referenceUrl}});renderProduct();toast('参考视频已导入');});
  on('#analyze-product','click',()=>propose([{kind:'product_analysis'}]));
  on('#analyze-reference','click',()=>propose([{kind:'reference_analysis'}]));
  on('#generate','click',()=>{const tasks=selectedTasks();if(!tasks.length)throw new Error('请至少选择一项生成内容');return propose(tasks);});
  on('#cancel-generate','click',()=>$('#task-dialog').close());
  on('#confirm-generate','click',async()=>{
    if(submitting)return;submitting=true;$('#confirm-generate').disabled=true;
    try{await api('/jobs',{method:'POST',body:pending,key:pending.key});$('#task-dialog').close();toast('任务已提交');await refreshJobs();}
    finally{submitting=false;$('#confirm-generate').disabled=false;}
  });
  for(const [id,format,name]of[['export-markdown','markdown','商品内容.md'],['export-csv','csv','视频脚本.csv'],['export-all','zip','商品内容包.zip']])on(`#${id}`,'click',async()=>{await save();await download(`/projects/${s.project.id}/export?format=${format}`,name);});
  on('#refresh-jobs','click',refreshJobs);
  on('#config-form','submit',async e=>{e.preventDefault();await saveConfig();toast('模型配置已保存');});
  document.addEventListener('click',async e=>{const t=e.target.closest('button');if(!t)return;try{
    if(t.dataset.view){await save();view(t.dataset.view);}
    if(t.dataset.mode)setMode(t.dataset.mode);
    if(t.dataset.output){s.output=t.dataset.output;renderResults();$('#result-area').scrollTop=0;}
    if(t.dataset.project)await selectProject(t.dataset.project);
    if(t.dataset.action)await action(t);
    if(t.dataset.check){await saveConfig();const result=await api('/config/check',{method:'POST',body:{provider:t.dataset.check}});$('#config-result').textContent=result.message;$('#config-result').hidden=false;}
    if(t.dataset.clear){s.config=await api('/config',{method:'PUT',body:{[t.dataset.clear==='wan'?'clearWan':'clearVidu']:true}});renderConfig();toast('密钥已清除');}
  }catch(error){toast(error.message);}});
  document.addEventListener('change',e=>{if(e.target.id==='image-count')s.imageCount=Number(e.target.value);if(e.target.id==='video-duration')s.videoDuration=Number(e.target.value);if(e.target.id==='video-index')s.videoIndex=Number(e.target.value);if(e.target.id==='video-audio')s.videoAudio=e.target.checked;});
  window.addEventListener('beforeunload',e=>{if(s.dirty){e.preventDefault();e.returnValue='';}});
  setInterval(async()=>{if(polling||projectManagementBusy()||document.hidden||$('#task-dialog').open||$('#editor-dialog').open)return;polling=true;try{await refreshJobs();$('#service-status').textContent='本机服务已连接';}catch{$('#service-status').textContent='连接中断';}finally{polling=false;}},5000);
}
init().catch(error=>{$('#connection-alert').hidden=false;$('#connection-alert').textContent=`无法连接本机服务：${error.message}。请运行启动脚本后打开 http://127.0.0.1:5188/`;});
