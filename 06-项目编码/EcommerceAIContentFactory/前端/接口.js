let token = '';
export const state = { project: null, config: {}, projects: [], jobs: [], view: 'production', mode: 'product', output: 'main', dirty: false, videoDuration: 10, videoAudio: true, videoIndex: 0, imageCount: 1 };
export const $ = selector => document.querySelector(selector);
export const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = name => `<i data-lucide="${name}"></i>`;
export const icons = () => window.lucide?.createIcons();
export const statusText = value => ({ queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败', needs_review: '待核对' }[value] || value);
export async function connect() { const response = await fetch('/api/v1/session'); if (!response.ok) throw new Error('本机服务连接失败'); token = (await response.json()).token; }
export async function api(route, { method = 'GET', body, key } = {}) {
  const headers = { 'X-Factory-Token': token };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(`/api/v1${route}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error(data.message || '请求失败，请稍后重试'), { status: response.status, code: data.code });
    if (['LICENSE_REQUIRED', 'ACCOUNT_REVOKED', 'DEVICE_ALREADY_BOUND', 'INVALID_LEASE', 'LEASE_EXPIRED'].includes(data.code)) document.dispatchEvent(new CustomEvent('factory-license-required'));
    throw error;
  }
  return data;
}
export async function download(route, name) {
  const response = await fetch(`/api/v1${route}`, { headers: { 'X-Factory-Token': token } });
  if (!response.ok) throw new Error((await response.json()).message);
  const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
let toastTimer;
export function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000); }
export function on(selector, event, handler) { $(selector).addEventListener(event, async e => { try { await handler(e); } catch (error) { toast(error.message); } }); }
