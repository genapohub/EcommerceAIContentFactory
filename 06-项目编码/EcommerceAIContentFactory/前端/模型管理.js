import { $, state as s, html as h, icon, icons, api, toast } from './接口.js';

const capabilities = { text_image: '文生图', image: '图生图', video: '图生视频', vision: '视觉分析', replica: '视频复刻' };
const glyphs = { text_image: 'image-plus', image: 'images', video: 'video', vision: 'scan-eye', replica: 'clapperboard' };
const statuses = { untested: '尚未测试', reachable: '接口连通', failed: '测试失败', unverified: '待实际验证' };
const testing = new Set();
let editingId; let deletingId; let initialized = false;
let search = ''; let filter = '';

async function refresh() {
  s.config = await api('/config'); renderModelManager();
  document.dispatchEvent(new CustomEvent('factory-models-changed'));
}
function renderList() {
  const models = [...(s.config.models || [])];
  if (s.config.modelOrder !== 'updated_desc') models.reverse();
  const selected = models.filter(m => (!filter || m.capability === filter) && `${m.name} ${m.model}`.toLowerCase().includes(search.toLowerCase()));
  $('#model-count').textContent = `${models.length} 个模型 · ${models.filter(m => m.enabled).length} 个已启用 · 最近更新优先`;
  $('#model-list').innerHTML = selected.length ? selected.map(m => {
    const busy = testing.has(m.id), check = m.check;
    const time = check.checkedAt ? new Date(check.checkedAt).toLocaleString('zh-CN') : '暂无测试记录';
    const updated = m.updatedAt ? `更新于 ${new Date(m.updatedAt).toLocaleString('zh-CN')}` : '历史配置';
    return `<article class="model-row ${m.enabled ? 'enabled' : ''}">
      <div class="model-avatar ${m.provider === 'vidu' ? 'reference' : ''}">${icon(glyphs[m.capability])}</div>
      <div class="model-description"><div class="model-title"><h3>${h(m.name)}</h3><span class="tag ${m.provider === 'vidu' ? 'blue' : ''}">${m.provider === 'wan' ? '阿里云百炼' : 'Vidu'}</span><span class="model-capability">${capabilities[m.capability]}</span></div><div class="model-code">${h(m.model)}</div><div class="model-endpoint">${h(m.baseUrl)}</div><small>${m.hasKey ? '密钥已设置' : '未设置密钥'} · ${h(updated)}</small></div>
      <div class="model-health" aria-live="polite"><span class="model-status ${busy ? 'testing' : check.status}">${icon(busy ? 'loader-circle' : check.status === 'reachable' ? 'circle-check' : check.status === 'failed' ? 'circle-alert' : 'circle-help')}${busy ? '测试中…' : statuses[check.status]}</span><small title="${h(check.message)}">${busy ? '正在检查连接' : h(check.message)}</small><small>${h(time)}${check.status === 'reachable' ? ` · ${check.latencyMs} ms` : ''}</small></div>
      <div class="model-actions"><button class="icon" data-model-test="${m.id}" title="测试连接" aria-label="测试 ${h(m.name)} 的连接" ${busy ? 'disabled' : ''}>${icon('plug-zap')}</button><button class="icon" data-model-edit="${m.id}" title="编辑模型" aria-label="编辑 ${h(m.name)}">${icon('pencil')}</button><button class="icon" data-model-delete="${m.id}" title="${m.enabled ? '停用后可删除' : '删除模型'}" aria-label="删除 ${h(m.name)}" ${m.enabled || busy ? 'disabled' : ''}>${icon('trash-2')}</button><button class="model-switch" role="switch" aria-label="启用 ${h(m.name)}" aria-checked="${m.enabled}" data-model-toggle="${m.id}" title="${m.enabled ? '禁用' : '启用'}模型"><span></span></button></div>
    </article>`;
  }).join('') : '<div class="empty"><strong>没有匹配的模型</strong><p>调整筛选条件，或新增模型配置。</p></div>';
  icons();
}
function openModel(id) {
  editingId = id; const model = s.config.models.find(m => m.id === id);
  const form = $('#model-editor-form'); form.reset();
  $('#model-editor-title').textContent = model ? '编辑模型' : '新增模型';
  form.elements.templateId.innerHTML = s.config.modelTemplates.map(t => `<option value="${t.id}">${h(t.label)} · ${h(t.model)}</option>`).join('');
  form.elements.templateId.value = model?.templateId || s.config.modelTemplates[0].id;
  form.elements.templateId.disabled = false;
  form.elements.name.value = model?.name || '';
  form.elements.workspaceId.value = model?.workspaceId || '';
  form.elements.enabled.checked = model?.enabled || false;
  form.elements.apiKey.placeholder = model?.hasKey ? '已设置，留空保留现有密钥' : '填写 API Key';
  $('#model-key-status').textContent = model?.hasKey ? '密钥已设置，原值不回显' : '尚未配置密钥';
  $('#model-editor-error').hidden = true; renderEndpoint(); $('#model-editor').showModal(); icons();
}
function renderEndpoint() {
  const f = $('#model-editor-form').elements;
  const template = s.config.modelTemplates.find(t => t.id === f.templateId.value);
  const original = s.config.models.find(m => m.id === editingId);
  const changedProvider = original && original.provider !== template.provider;
  $('#model-key-status').textContent = changedProvider ? '切换厂商后需配置新的 API Key，原密钥不会跨厂商使用' : original?.hasKey ? '密钥已设置，留空保留现有密钥' : '尚未配置密钥';
  f.apiKey.placeholder = changedProvider ? '填写新厂商的 API Key' : original?.hasKey ? '留空保留现有密钥' : '填写 API Key';
  $('#model-workspace').hidden = template.provider !== 'wan';
  $('#model-endpoint-value').textContent = template.provider === 'vidu' ? 'https://api.vidu.cn' : f.workspaceId.value ? `https://${f.workspaceId.value}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com';
}
function initialize() {
  const host = $('#model-manager');
  host.innerHTML = `<div class="model-heading"><div><h2>模型列表</h2><small id="model-count"></small></div><button class="primary" id="add-model">${icon('plus')}新增模型</button></div>
    <div class="model-filters"><label class="model-search">${icon('search')}<input id="model-search" aria-label="搜索模型" placeholder="搜索模型名称或 ID"></label><select id="model-filter" aria-label="按能力筛选"><option value="">全部能力</option>${Object.entries(capabilities).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></div>
    <div id="model-list"></div><p class="muted">每种能力使用一个已启用模型；启用同类模型会切换后续任务。已提交任务保留原模型。</p>
    <details class="model-budget"><summary>费用与预算</summary><form id="model-budget-form"><div class="two"><label>单批预估上限（元）<input name="maxTaskYuan" type="number" min="1" max="1000" required></label><label>Vidu预估费率（元/秒）<input name="viduSecondYuan" type="number" min="0.01" max="20" step="0.01" required></label></div><label class="check"><input name="viduBillingConfirmed" type="checkbox">已核对Vidu账号计费口径与适用费率</label><button type="submit">${icon('save')}保存预算</button></form></details>`;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="model-editor"><form id="model-editor-form"><div class="dialog-heading"><h2 id="model-editor-title">新增模型</h2><button type="button" class="icon" id="close-model-editor" aria-label="关闭模型编辑">${icon('x')}</button></div><div class="model-editor-fields"><label>配置名称<input name="name" maxlength="80" required placeholder="例如 万相主图 · 店铺A"></label><label>国内模型<select name="templateId"></select></label><label id="model-workspace">百炼业务空间 ID <span>选填</span><input name="workspaceId" maxlength="80" pattern="[a-zA-Z0-9-]*"></label><div class="model-address"><span>接口地址</span><code id="model-endpoint-value"></code></div><label>API Key<input name="apiKey" type="password" maxlength="500" autocomplete="off"></label><small id="model-key-status"></small><label class="check"><input name="clearKey" type="checkbox">清除已有密钥</label><label class="check"><input name="enabled" type="checkbox">启用此模型（切换同类能力）</label><p class="muted">密钥仅保存在当前服务会话中，重启后需重新填写。</p><p class="notice error" id="model-editor-error" hidden></p></div><div class="dialog-footer"><button type="submit" class="primary" id="save-model">${icon('save')}保存模型</button></div></form></dialog>`);
  $('#add-model').addEventListener('click', () => openModel());
  document.body.insertAdjacentHTML('beforeend', `<dialog id="model-delete-dialog" aria-labelledby="model-delete-title"><form id="model-delete-form"><div class="dialog-heading"><h2 id="model-delete-title">删除模型配置</h2><button type="button" class="icon" id="close-model-delete" aria-label="关闭删除确认">${icon('x')}</button></div><p id="model-delete-copy"></p><p class="notice error" id="model-delete-error" role="alert" hidden></p><div class="dialog-footer row"><button type="button" id="cancel-model-delete">取消</button><button type="submit" id="confirm-model-delete">${icon('trash-2')}确认删除</button></div></form></dialog>`);
  const deleteDialog = $('#model-delete-dialog');
  let deleting = false;
  const closeDelete = () => { if (!deleting) deleteDialog.close(); };
  $('#close-model-delete').addEventListener('click', closeDelete);
  $('#cancel-model-delete').addEventListener('click', closeDelete);
  deleteDialog.addEventListener('cancel', e => { if (deleting) e.preventDefault(); });
  $('#model-delete-form').addEventListener('submit', async e => {
    e.preventDefault(); if (deleting) return;
    deleting = true; $('#confirm-model-delete').disabled = true; $('#model-delete-error').hidden = true;
    try {
      await api(`/config/models/${deletingId}`, { method: 'DELETE' });
      await refresh(); deleteDialog.close(); toast('模型配置已删除');
    } catch (error) { $('#model-delete-error').textContent = error.message; $('#model-delete-error').hidden = false; }
    finally { deleting = false; $('#confirm-model-delete').disabled = false; }
  });
  $('#model-search').addEventListener('input', e => { search = e.target.value; renderList(); });
  $('#model-filter').addEventListener('change', e => { filter = e.target.value; renderList(); });
  $('#close-model-editor').addEventListener('click', () => $('#model-editor').close());
  $('#model-editor-form').elements.templateId.addEventListener('change', () => {
    const f = $('#model-editor-form').elements;
    f.apiKey.value = '';
    const original = s.config.models.find(m => m.id === editingId);
    const next = s.config.modelTemplates.find(t => t.id === f.templateId.value);
    if (original && original.provider !== next.provider) f.workspaceId.value = '';
    renderEndpoint();
  });
  $('#model-editor-form').elements.workspaceId.addEventListener('input', renderEndpoint);
  $('#model-editor-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget.elements; const button = $('#save-model'); if (button.disabled) return; button.disabled = true;
    try {
      await api(`/config/models${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', body: { name: f.name.value, templateId: f.templateId.value, workspaceId: f.workspaceId.value, apiKey: f.apiKey.value, clearKey: f.clearKey.checked, enabled: f.enabled.checked } });
      f.apiKey.value = ''; $('#model-editor').close(); search = ''; filter = ''; $('#model-search').value = ''; $('#model-filter').value = ''; await refresh(); toast('模型配置已保存');
    } catch (error) { $('#model-editor-error').textContent = error.message; $('#model-editor-error').hidden = false; }
    finally { button.disabled = false; }
  });
  host.addEventListener('click', async e => {
    const target = e.target.closest('button'); if (!target) return;
    try {
      if (target.dataset.modelEdit) openModel(target.dataset.modelEdit);
      if (target.dataset.modelDelete) {
        const m = s.config.models.find(m => m.id === target.dataset.modelDelete);
        if (!m || m.enabled || testing.has(m.id)) return;
        deletingId = m.id;
        $('#model-delete-copy').textContent = `确认删除“${m.name}”？此配置及其密钥将移除，已有成品不受影响。`;
        $('#model-delete-error').hidden = true;
        deleteDialog.showModal(); $('#cancel-model-delete').focus();
      }
      if (target.dataset.modelToggle) { const m = s.config.models.find(m => m.id === target.dataset.modelToggle); target.disabled = true; await api(`/config/models/${m.id}`, { method: 'PATCH', body: { enabled: !m.enabled } }); await refresh(); }
      if (target.dataset.modelTest) {
        const id = target.dataset.modelTest; if (testing.has(id)) return; testing.add(id); renderList();
        try { await api(`/config/models/${id}/check`, { method: 'POST', body: {} }); } finally { testing.delete(id); await refresh(); }
      }
    } catch (error) { toast(error.message); renderList(); }
  });
  $('#model-budget-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget.elements;
    try { await api('/config', { method: 'PUT', body: { maxTaskYuan: Number(f.maxTaskYuan.value), viduSecondYuan: Number(f.viduSecondYuan.value), viduBillingConfirmed: f.viduBillingConfirmed.checked } }); await refresh(); toast('预算已保存'); }
    catch (error) { toast(error.message); }
  });
}
export function renderModelManager() {
  $('#model-manager').hidden = false;
  if (!initialized) { initialize(); initialized = true; }
  const f = $('#model-budget-form').elements;
  for (const name of ['maxTaskYuan','viduSecondYuan']) f[name].value = s.config[name];
  f.viduBillingConfirmed.checked = s.config.viduBillingConfirmed;
  renderList();
}
