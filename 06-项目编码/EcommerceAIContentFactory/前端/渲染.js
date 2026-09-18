import { $, state as s, html as h, icon, icons, statusText } from './接口.js';
import { renderModelManager } from './模型管理.js';
export const labels = { main_image: '商品主图', text_image: '创意图片', detail_image: '分屏详情', intro_video: '介绍视频', replica_video: '参考视频复刻', product_analysis: '商品卖点分析', reference_analysis: '参考视频分析', layout: '详情重新排版' };
const button = (action, label, glyph, data = '') => `<button data-action="${action}" ${data}>${icon(glyph)}${label}</button>`;
const empty = (glyph, title, message) => `<div class="empty">${icon(glyph)}<strong>${title}</strong><p>${message}</p></div>`;
const outputAssets = () => s.project.assets.filter(a => ['main_image', 'text_image', 'detail_image', 'intro_video', 'replica_video'].includes(a.kind));
export function renderProjects() {
  $('#project-switch').innerHTML = s.projects.map(p => `<option value="${p.id}" ${p.id === s.project?.id ? 'selected' : ''}>${h(p.name)}</option>`).join('');
  $('#project-list').innerHTML = s.projects.map(p => `<div class="project-entry ${p.id === s.project?.id ? 'active' : ''}"><button class="project-item ${p.id === s.project?.id ? 'active' : ''}" data-project="${p.id}" title="${h(p.name)}">${h(p.name)}</button><button class="icon" data-project-command="rename" data-id="${p.id}" title="重命名项目" aria-label="重命名 ${h(p.name)}">${icon('pencil')}</button><button class="icon" data-project-command="delete" data-id="${p.id}" title="删除项目" aria-label="删除 ${h(p.name)}">${icon('trash-2')}</button></div>`).join('') || '<small class="project-list-empty">暂无商品项目</small>';
  $('#project-switch').disabled = !s.projects.length;
  document.querySelectorAll('.compact-projects [data-project-command]').forEach(b => { b.disabled = !s.project; });
  icons();
}
export function renderProduct() {
  const p = s.project;
  $('.workspace').hidden = !p;
  if ($('#project-empty-state')) $('#project-empty-state').hidden = Boolean(p);
  $('#save-project').disabled = !p;
  if (!p) { $('#output-summary').textContent = ''; $('#save-status').textContent = ''; renderProjects(); return; }
  if (!s.dirty) $('#save-status').textContent = '已保存';
  for (const [key, value] of Object.entries(p.fields)) { const input = $('#product-form').elements.namedItem(key); if (input) input.value = value; }
  const image = p.assets.find(a => a.id === p.imageId);
  $('#product-preview').innerHTML = image ? `<img src="${image.url}" alt="${h(p.fields.name || '商品原始照片')}">` : `${icon('camera')}<strong>拍摄 / 上传商品照片</strong><span>JPG、PNG、WebP</span>`;
  const ref = p.assets.find(a => a.id === p.referenceId);
  $('#reference-preview').innerHTML = ref ? `<video controls preload="metadata" src="${ref.url}"></video><small>${h(ref.name)} · ${Math.round(ref.duration)}秒</small>` : '';
  $('#remove-image').disabled = !image; renderResults(); renderProjects();
}
function mediaCard(asset) {
  const visual = asset.mime.startsWith('image/') ? `<a href="${asset.url}" target="_blank" rel="noopener"><img src="${asset.url}" alt="${h(asset.name)}" loading="lazy"></a>` : `<video controls preload="metadata" ${asset.posterUrl ? `poster="${asset.posterUrl}"` : ''} src="${asset.url}"></video>`;
  return `<article class="media-card">${visual}<div class="card-meta"><strong>${h(asset.name)}</strong><div class="row split"><small>${asset.width} × ${asset.height}${asset.duration ? ` · ${Math.round(asset.duration)}秒` : ''}</small><a class="button" href="${asset.url}?download=1" download title="下载成品">${icon('download')}</a></div></div></article>`;
}
function details() {
  return `<div class="media-grid">${s.project.plan.screens.map((screen, i) => {
    const asset = s.project.assets.find(a => a.kind === 'detail_image' && a.screenIndex === i);
    return `<article class="media-card detail">${asset ? `<a href="${asset.url}" target="_blank" rel="noopener"><img src="${asset.url}" alt="${h(screen.title)}" loading="lazy"></a>` : `<div class="placeholder"><b>${String(i + 1).padStart(2, '0')}</b><h3>${h(screen.title)}</h3><p>${h(screen.copy || '待生成配图')}</p></div>`}<div class="card-meta"><strong>${i + 1}. ${h(screen.title)}</strong><div class="row">${button('edit-screen', '编辑', 'pencil', `data-index="${i}"`)}${button('screen', '生成', 'sparkles', `data-index="${i}"`)}${asset ? `<a class="button" href="${asset.url}?download=1" download title="下载分屏">${icon('download')}</a>` : ''}</div>${asset ? button('layout', '更新排版 · 免费', 'type', `data-index="${i}"`) : ''}</div></article>`;
  }).join('')}</div>`;
}
function plan() {
  const p = s.project;
  return `<section class="plan-section"><div class="section-heading"><h2>商品卖点</h2>${button('add-point', '添加', 'plus')}</div>${p.plan.points.length ? p.plan.points.map((point, i) => `<div class="point">${icon(point.locked ? 'lock-keyhole' : 'circle-check')}<div><strong>${h(point.title)}</strong><p class="muted">${h(point.proof || '待补充证明材料')}</p></div>${button('edit-point', '', 'pencil', `data-index="${i}" title="编辑卖点"`)}</div>`).join('') : '<p class="muted">尚未添加卖点</p>'}<small>${p.plan.source === 'ai' ? '已应用AI分析，发布前核对商品事实' : '当前为资料草稿，尚未应用AI分析'}</small></section>
  <section class="plan-section"><div class="section-heading"><h2>短视频方案</h2><span class="tag">${p.plan.videos.length} 条</span></div>${p.plan.videos.map((v, i) => `<article class="script"><div class="row split"><strong>${i + 1}. ${h(v.title)}</strong>${button('edit-video', '编辑', 'pencil', `data-index="${i}"`)}</div><p><b>开头：</b>${h(v.hook || '待补充')}</p><p><b>口播：</b>${h(v.voiceover || '待补充')}</p>${v.shots.map(shot => `<p class="muted">${h(shot.time)} · ${h(shot.action)}${shot.caption ? ` / ${h(shot.caption)}` : ''}</p>`).join('')}<p><b>CTA：</b>${h(v.cta)}</p></article>`).join('')}</section>
  <section class="plan-section"><h2>参考视频结构</h2>${p.plan.reference?.source === 'ai' ? `<div class="reference-text">${[['hook','开头钩子'],['pain','痛点'],['proof','信任证明'],['cta','行动引导']].map(([key,label]) => `<p><b>${label}：</b>${h(p.plan.reference[key])}</p>`).join('')}${p.plan.reference.shots.map(shot => `<div>${h(shot.time)} · ${h(shot.action)}</div>`).join('')}</div>` : '<p class="muted">尚未分析参考视频</p>'}</section>
  <section class="plan-section"><h2>发布前检查</h2><p class="${p.check.terms.length ? 'risk' : 'muted'}">${p.check.terms.length ? `风险表达：${p.check.terms.map(h).join('、')}` : '未命中内置风险词，仍需人工核对功效与素材授权。'}</p><p class="muted">${p.check.unproven.length ? `缺少卖点证明：${p.check.unproven.map(h).join('、')}` : '当前卖点均已填写证明，真实性需人工核对。'}</p></section>`;
}
export function renderResults() {
  if (!s.project) return;
  const assets = outputAssets();
  $('#main-count').textContent = assets.filter(a => ['main_image','text_image'].includes(a.kind)).length;
  $('#detail-count').textContent = new Set(assets.filter(a => a.kind === 'detail_image').map(a => a.screenIndex)).size;
  $('#video-count').textContent = assets.filter(a => a.mime.startsWith('video/')).length;
  $('#output-summary').textContent = `${s.project.fields.name || '未命名商品'} · ${assets.length} 个成品`;
  document.querySelectorAll('[data-output]').forEach(b => { b.classList.toggle('active', b.dataset.output === s.output); b.setAttribute('aria-selected', String(b.dataset.output === s.output)); });
  const notice = $('#configuration-notice');
  const missing = s.mode === 'replica' ? !s.config.hasViduKey : !s.config.hasWanKey;
  notice.hidden = !missing;
  notice.innerHTML = `${s.mode === 'replica' ? 'Vidu' : '百炼'}尚未配置。 <button class="subtle" data-action="config">配置国内模型 ${icon('arrow-right')}</button>`;
  if (s.output === 'main') {
    $('#output-toolbar').innerHTML = `<label>生成数量<select id="image-count">${[1,2,3].map(n => `<option ${s.imageCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label><span class="muted">1:1 · 1280 px</span>${button('text-image', '文生图', 'type')}`;
    const images = assets.filter(a => ['main_image','text_image'].includes(a.kind));
    $('#result-area').innerHTML = images.length ? `<div class="media-grid">${images.map(mediaCard).join('')}</div>` : empty('image', '商品主图将在这里呈现', '尚无已生成主图');
  } else if (s.output === 'details') {
    $('#output-toolbar').innerHTML = `<span class="muted">${s.project.plan.screens.length} 屏 · 900 × 1200 px / 屏</span>${button('long-image', '导出长图', 'download')}`;
    $('#result-area').innerHTML = details();
  } else if (s.output === 'videos') {
    $('#output-toolbar').innerHTML = s.mode === 'replica' ? '<span class="muted">Vidu · 参考视频复刻 · 720P</span>' : `<label>时长<select id="video-duration">${[5,10,15].map(n=>`<option value="${n}" ${s.videoDuration === n ? 'selected' : ''}>${n}秒</option>`).join('')}</select></label><label>方案<select id="video-index">${s.project.plan.videos.map((v,i)=>`<option value="${i}" ${s.videoIndex === i ? 'selected' : ''}>${h(v.title)}</option>`).join('')}</select></label><label><input type="checkbox" id="video-audio" ${s.videoAudio ? 'checked' : ''}>生成音频</label>${button('three-videos', '生成3条方案', 'film')}`;
    const videos = assets.filter(a => a.mime.startsWith('video/'));
    $('#result-area').innerHTML = videos.length ? `<div class="media-grid">${videos.map(mediaCard).join('')}</div>` : empty('clapperboard', s.mode === 'replica' ? '复刻成片将在这里呈现' : '商品介绍视频将在这里呈现', '尚无已生成视频');
  } else {
    $('#output-toolbar').innerHTML = '<span class="muted">卖点、分镜、文案可编辑</span>'; $('#result-area').innerHTML = plan();
    if (s.project.check.copied) $('#result-area').insertAdjacentHTML('beforeend','<p class="notice error">文案与参考连续重复20字以上，请改写后发布。</p>');
    if (s.project.check.missingPoints?.length) $('#result-area').insertAdjacentHTML('beforeend',`<p class="notice error">以下分屏的来源卖点已失效：${s.project.check.missingPoints.map(h).join('、')}</p>`);
  }
  const jobs = s.project.jobs.filter(j => ['queued','running','needs_review'].includes(j.status));
  $('#recent-job').innerHTML = jobs.length ? `${icon('activity')} ${jobs.length} 个任务进行中或待核对 <button class="subtle" data-action="history">查看任务</button>` : '';
  icons();
}
export function renderJobs() {
  $('#active-count').textContent = s.jobs.filter(j => ['running','queued'].includes(j.status)).length;
  $('#jobs-list').innerHTML = s.jobs.length ? s.jobs.map(j => `<article class="job"><div class="job-head"><strong>${h(j.projectName)} · ${h(j.label)}</strong><span class="status ${j.status}">${statusText(j.status)}</span></div><p class="muted">${new Date(j.createdAt).toLocaleString('zh-CN')} · ${j.provider === 'vidu' ? 'Vidu' : '百炼'} · ${j.estimate === null ? '按Token计费' : `预估 ¥${j.estimate.toFixed(2)}`}${j.upstreamId ? ` · 编号 ${h(j.upstreamId)}` : ''}</p>${j.error ? `<p class="risk">${h(j.error)}</p>` : ''}<div class="row">${j.result ? button('apply', '应用分析结果', 'check', `data-id="${j.id}"`) : ''}${['failed','needs_review'].includes(j.status) ? button('retry', j.upstreamId && j.errorCode !== 'PROVIDER_REJECTED' || j.sourceId || j.stage === 'saving' ? '继续查询 / 下载' : '重新提交', 'refresh-cw', `data-id="${j.id}"`) : ''}${button('open-project', '查看商品', 'arrow-up-right', `data-id="${j.projectId}"`)}</div></article>`).join('') : empty('list-checks', '暂无生成记录', '已提交的任务会保存在这里');
  icons();
}
export function renderConfig() {
  if (s.config.models) { $('#config-form').hidden = true; renderModelManager(); return; }
  const form = $('#config-form');
  for (const key of ['workspaceId','visionModel','viduSecondYuan','maxTaskYuan']) form.elements[key].value = s.config[key] ?? '';
  form.elements.viduBillingConfirmed.checked = s.config.viduBillingConfirmed;
  form.elements.wanKey.value = ''; form.elements.viduKey.value = '';
  $('#wan-status').textContent = s.config.hasWanKey ? '已保存密钥' : '未配置';
  $('#vidu-status').textContent = s.config.hasViduKey ? '已保存密钥' : '未配置'; icons();
}
