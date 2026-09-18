import { $, state as s, icon, icons, api, toast } from './接口.js';
import { renderProjects, renderProduct } from './渲染.js';

let busy = false;
export const projectManagementBusy = () => busy;

export function bindProjectManagement({ save, selectProject, refreshJobs }) {
  const style = document.createElement('link');
  style.rel = 'stylesheet'; style.href = '/static/项目管理.css'; document.head.append(style);
  $('.compact-projects').insertAdjacentHTML('beforeend', `<button class="icon" data-project-command="rename" title="重命名当前项目" aria-label="重命名当前项目">${icon('pencil')}</button><button class="icon" data-project-command="delete" title="删除当前项目" aria-label="删除当前项目">${icon('trash-2')}</button>`);
  $('.workspace').insertAdjacentHTML('beforebegin', `<div id="project-empty-state" class="empty" hidden>${icon('package-plus')}<strong>暂无商品项目</strong><button class="primary" data-action="new-project">${icon('plus')}新建商品项目</button></div>`);
  document.body.insertAdjacentHTML('beforeend', `<dialog id="project-manager-dialog" aria-labelledby="project-manager-title"><form id="project-manager-form"><div class="dialog-heading"><h2 id="project-manager-title"></h2><button type="button" class="icon" id="project-manager-close" aria-label="关闭项目管理">${icon('x')}</button></div><label id="project-rename-field">项目名称<input name="name" maxlength="100" required autocomplete="off"></label><p id="project-delete-copy" hidden></p><p class="notice error" id="project-manager-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" id="project-manager-cancel">取消</button><button type="submit" class="primary" id="project-manager-submit"></button></div></form></dialog>`);
  const dialog = $('#project-manager-dialog'), form = $('#project-manager-form');
  let selectedId, command;
  function close() { if (!busy) dialog.close(); }
  $('#project-manager-close').addEventListener('click', close);
  $('#project-manager-cancel').addEventListener('click', close);
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-project-command]');
    if (!target || busy) return;
    selectedId = target.dataset.id || s.project?.id;
    const project = s.projects.find(p => p.id === selectedId);
    if (!project) return;
    command = target.dataset.projectCommand;
    const deleting = command === 'delete';
    $('#project-manager-title').textContent = deleting ? '删除商品项目' : '重命名商品项目';
    $('#project-rename-field').hidden = deleting; form.elements.name.disabled = deleting;
    form.elements.name.value = project.id === s.project?.id ? $('#product-form').elements.name.value : project.name;
    $('#project-delete-copy').hidden = !deleting;
    $('#project-delete-copy').textContent = `确认删除“${project.name}”？该项目的资料、素材、成品和任务记录将一并删除，无法撤销。${s.dirty && s.project?.id === selectedId ? '当前未保存的修改也会丢弃。' : ''}`;
    $('#project-manager-submit').textContent = deleting ? '确认删除' : '保存名称';
    $('#project-manager-submit').classList.toggle('danger', deleting);
    $('#project-manager-error').hidden = true;
    dialog.showModal();
    if (deleting) $('#project-manager-cancel').focus(); else { form.elements.name.focus(); form.elements.name.select(); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const name = form.elements.name.value.trim();
    if (command === 'rename' && !name) { form.elements.name.setCustomValidity('请输入项目名称'); form.elements.name.reportValidity(); return; }
    busy = true; $('#project-manager-submit').disabled = true; $('#project-manager-error').hidden = true;
    let cleanupPending = false;
    try {
      if (command === 'rename') {
        await save();
        const project = await api(`/projects/${selectedId}/name`, { method: 'PATCH', body: { name } });
        if (s.project?.id === selectedId) { s.project = project; renderProduct(); }
      } else {
        const deletingCurrent = s.project?.id === selectedId;
        if (!deletingCurrent) await save();
        const result = await api(`/projects/${selectedId}`, { method: 'DELETE' });
        if (deletingCurrent) { s.project = null; s.dirty = false; localStorage.removeItem('factory-project'); }
        s.projects = await api('/projects');
        if (deletingCurrent && s.projects.length) await selectProject(s.projects[0].id);
        renderProduct();
        await refreshJobs(true);
        cleanupPending = result.cleanupPending;
      }
      s.projects = await api('/projects'); renderProjects(); dialog.close();
      toast(command === 'rename' ? '项目已重命名' : cleanupPending ? '项目已删除，部分占用中的本地文件未能清理' : '商品项目已删除');
    } catch (error) { $('#project-manager-error').textContent = error.message; $('#project-manager-error').hidden = false; }
    finally { busy = false; $('#project-manager-submit').disabled = false; }
  });
  form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
  icons(); renderProjects();
}
