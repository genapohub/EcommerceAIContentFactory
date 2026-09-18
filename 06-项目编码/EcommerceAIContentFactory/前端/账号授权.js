import { $, icon, icons, api, toast } from './接口.js';

let current;
function render() {
  const status = current;
  $('#license-state').textContent = status.authorized ? '本机已授权' : status.legacy ? '服务待升级' : '待激活';
  $('#license-state').className = `tag ${status.authorized ? '' : 'blue'}`;
  $('#license-summary').textContent = status.message;
  $('#license-account').textContent = status.account || '尚未登录';
  $('#license-device').textContent = status.deviceId ? `${status.deviceId.slice(0, 12)}…${status.deviceId.slice(-6)}` : '等待设备识别';
  $('#license-expiry').textContent = status.expiresAt ? new Date(status.expiresAt).toLocaleString('zh-CN') : '尚未签发';
  $('#license-form').hidden = status.authorized || !status.configured;
  $('#license-renew').hidden = !status.authorized;
  $('#license-logout').hidden = !status.authorized;
  $('#license-export-device').hidden = !status.devicePublicKey;
  $('#license-setup').hidden = status.configured;
  $('#license-setup').textContent = status.legacy ? '当前服务尚未加载账号授权模块。请在新版工作台完成激活。' : '尚未连接授权服务，请由管理员完成部署配置后激活。';
  icons();
}

export async function initializeAuthorization(showView) {
  $('#license-view').innerHTML = `<div class="auth-panel"><div class="section-heading"><div><h2>账号与设备</h2><p class="muted">单账号 · 单台电脑</p></div><span id="license-state" class="tag"></span></div>
    <div class="auth-status">${icon('shield-check')}<div><strong id="license-summary"></strong><p class="muted">换机需管理员解除原设备绑定。退出登录不会解除绑定。</p></div></div>
    <dl class="auth-facts"><div><dt>当前账号</dt><dd id="license-account"></dd></div><div><dt>本机标识</dt><dd id="license-device"></dd></div><div><dt>授权有效至</dt><dd id="license-expiry"></dd></div></dl>
    <p class="notice" id="license-setup" hidden></p>
    <form id="license-form" class="auth-fields"><label>账号<input name="account" autocomplete="username" maxlength="120" required placeholder="管理员分配的账号"></label><label>密码<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><p id="license-error" class="notice error" role="alert" hidden></p><button type="submit" class="primary">${icon('key-round')}登录并激活本机</button></form>
    <div class="row"><button id="license-renew">${icon('refresh-cw')}刷新授权</button><button id="license-export-device">${icon('download')}下载换机申请</button><button id="license-logout" class="subtle">${icon('log-out')}退出登录</button></div></div>`;
  try { current = await api('/license'); }
  catch (error) {
    if (error.status !== 404) throw error;
    current = { authorized: false, configured: false, legacy: true, message: '当前服务不支持设备授权' };
  }
  render();
  $('#license-nav').addEventListener('click', () => showView('license'));
  $('#license-export-device').addEventListener('click', () => {
    const data = { version: 1, machineId: current.deviceId, devicePublicKey: current.devicePublicKey };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '设备换机申请.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  $('#license-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button');
    if (button.disabled) return; button.disabled = true; $('#license-error').hidden = true;
    try {
      await api('/license/activate', { method: 'POST', body: { account: form.elements.account.value, password: form.elements.password.value } });
      form.elements.password.value = ''; location.reload();
    } catch (error) { form.elements.password.value = ''; $('#license-error').textContent = error.message; $('#license-error').hidden = false; }
    finally { button.disabled = false; }
  });
  $('#license-renew').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { current = await api('/license/refresh', { method: 'POST', body: {} }); render(); toast('本机授权已更新'); }
    catch (error) { toast(error.message); }
    finally { $('#license-renew').disabled = false; }
  });
  $('#license-logout').addEventListener('click', async () => {
    if (!confirm('退出本机账号？设备绑定将保留，重新使用时需要登录。')) return;
    try { await api('/license/logout', { method: 'POST', body: {} }); location.reload(); }
    catch (error) { toast(error.message); }
  });
  document.addEventListener('factory-license-required', () => {
    current = { ...current, authorized: false, message: '本机授权已失效，请重新登录或联系管理员。' };
    render(); showView('license');
  });
  return current;
}

export function lockWorkspace(showView, renderConfig) {
  for (const selector of ['[data-view="production"]', '[data-view="history"]', '#new-project', '#save-project', '#project-switch']) {
    const element = $(selector); if (element) element.disabled = true;
  }
  $('[data-view="config"]').addEventListener('click', () => { showView('config'); renderConfig(); });
  showView('license');
}
