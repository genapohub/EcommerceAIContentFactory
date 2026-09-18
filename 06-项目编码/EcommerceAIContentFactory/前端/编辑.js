import { $, state as s, html as h, icons, api, toast, on } from './接口.js';
import { renderResults } from './渲染.js';
let edit;
const field = (name, label, value, max, rows = 0) => `<label>${label}${rows ? `<textarea name="${name}" rows="${rows}" maxlength="${max}">${h(value)}</textarea>` : `<input name="${name}" maxlength="${max}" value="${h(value)}">`}</label>`;
export function openEditor(kind, index = 0, callback) {
  edit = { kind, index, callback };
  let content = '';
  if (kind === 'screen') {
    const v = s.project.plan.screens[index]; $('#editor-title').textContent = `编辑第 ${index + 1} 屏`;
    content = field('title','标题',v.title,60) + field('copy','正文',v.copy,500,4) + field('prompt','画面描述',v.prompt,1000,3) + `<label>来源卖点<select name="pointId"><option value="">未关联</option>${s.project.plan.points.map(p=>`<option value="${h(p.id)}" ${p.id === v.pointId ? 'selected' : ''}>${h(p.title)}</option>`).join('')}</select></label>`;
  } else if (kind === 'video') {
    const v = s.project.plan.videos[index]; $('#editor-title').textContent = '编辑视频方案';
    content = field('title','方案标题',v.title,80) + field('hook','前3秒钩子',v.hook,200,2) + field('voiceover','口播文案',v.voiceover,1500,4) + v.shots.map((shot,i) => `<div class="two">${field(`time-${i}`,`镜头 ${i+1} 时间`,shot.time,40)}${field(`caption-${i}`,'字幕',shot.caption,160)}</div>${field(`action-${i}`,'画面',shot.action,500,2)}`).join('') + field('cta','行动引导',v.cta,200);
  } else if (kind === 'point') {
    const v = s.project.plan.points[index] || { title:'',proof:'',locked:false }; $('#editor-title').textContent = '编辑卖点';
    content = field('title','卖点',v.title,80) + field('proof','证明材料 / 依据',v.proof,500,3) + `<label class="check"><input type="checkbox" name="locked" ${v.locked ? 'checked' : ''}>锁定此卖点</label>`;
  } else {
    $('#editor-title').textContent = '文生图';
    content = field('prompt','图片描述','',1800,6);
  }
  $('#editor-content').innerHTML = content; $('#editor-dialog').showModal(); icons();
}
export function bindEditor() {
  on('#close-editor','click',()=>$('#editor-dialog').close());
  on('#editor-form','submit',async e => {
    e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));
    if (edit.kind === 'text') {
      if (!values.prompt.trim()) throw new Error('请输入图片描述');
      $('#editor-dialog').close(); await edit.callback(values.prompt); return;
    }
    const plan = structuredClone(s.project.plan);
    if (edit.kind === 'screen') Object.assign(plan.screens[edit.index],values);
    if (edit.kind === 'point') {
      if (!values.title.trim()) throw new Error('请填写卖点');
      plan.points[edit.index] = { id: plan.points[edit.index]?.id || crypto.randomUUID(), title:values.title,proof:values.proof,locked:values.locked === 'on' };
    }
    if (edit.kind === 'video') {
      const v = plan.videos[edit.index]; for (const key of ['title','hook','voiceover','cta']) v[key] = values[key];
      v.shots = v.shots.map((shot,i) => ({ time:values[`time-${i}`],caption:values[`caption-${i}`],action:values[`action-${i}`] }));
    }
    s.project = await api(`/projects/${s.project.id}`,{method:'PATCH',body:{plan}});
    $('#editor-dialog').close(); renderResults(); toast('修改已保存');
  });
}
