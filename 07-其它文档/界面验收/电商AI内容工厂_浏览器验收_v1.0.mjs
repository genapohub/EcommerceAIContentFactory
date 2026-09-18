import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  assert(args[index + 1] && !args[index + 1].startsWith('--'), `${name} 缺少参数`);
  return args[index + 1];
};
const flags = new Set(['--local-login', '--require-authorized', '--wait-login', '--headed']);
const options = new Set(['--url', '--widths', '--out', '--project', '--browser']);
for (let i = 0; i < args.length; i++) {
  assert(flags.has(args[i]) || options.has(args[i]), `未知参数：${args[i]}`);
  if (options.has(args[i])) i++;
}
const project = path.resolve(value('--project', path.join(directory, '../../06-项目编码/EcommerceAIContentFactory')));
const widths = value('--widths', '320,375,600,760,900,1100,1440,1920').split(',').map(Number);
assert(widths.length && widths.every(n => Number.isInteger(n) && n >= 320 && n <= 3840), '宽度范围为320至3840');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(value('--out', path.join(directory, `复验_${stamp}`)));
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), result: '进行中', mode: args.includes('--local-login') ? '隔离真实登录' : '现有本机服务',
  browser: value('--browser', 'chrome'), widths, authorized: false, checks: [], screenshots: [], pageErrors: [], httpErrors: [], source: project };
let browser, page, isolated;

function loadPlaywright() {
  const require = createRequire(path.join(project, 'package.json'));
  for (const source of [process.env.FACTORY_UI_PLAYWRIGHT, 'playwright',
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean)) {
    try { return require(source); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('找不到 Playwright。设置 FACTORY_UI_PLAYWRIGHT 为现有 playwright 包目录。');
}

async function capture(name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(output, filename), fullPage: true, animations: 'disabled' });
  report.screenshots.push(filename);
}

async function checkLayout(label) {
  const issues = await page.evaluate(() => {
    const found = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) found.push('页面横向溢出');
    for (const e of document.querySelectorAll('.model-row,.auth-facts,.auth-fields,.topbar,.output-heading,dialog[open]')) {
      if (!e.checkVisibility()) continue;
      const r = e.getBoundingClientRect();
      if (r.left < -1 || r.right > innerWidth + 1 || e.scrollWidth > e.clientWidth + 1) found.push(e.className || e.tagName);
    }
    const nav = [...document.querySelectorAll('.sidebar .nav')].map(e => e.getBoundingClientRect());
    if (innerWidth <= 760) {
      if (nav.length !== 4 || nav.some(r => r.height < 44 || Math.abs(r.y - nav[0].y) > 1)) found.push('四按钮导航尺寸或对齐异常');
      for (let i = 1; i < nav.length; i++) if (nav[i - 1].right > nav[i].left + 1) found.push('导航重叠');
    }
    return found;
  });
  report.checks.push({ label, passed: issues.length === 0, issues });
  assert.deepEqual(issues, [], label);
}

// 会话令牌只在浏览器内读取和使用，不写入报告、截图或控制台。
async function licenseState() {
  return page.evaluate(async () => {
    const session = await fetch('/api/v1/session').then(r => r.json());
    const response = await fetch('/api/v1/license', { headers: { 'X-Factory-Token': session.token } });
    if (response.status === 404) return { legacy: true, authorized: false, configured: false };
    if (!response.ok) throw new Error(`授权状态接口失败：HTTP ${response.status}`);
    const state = await response.json();
    return { authorized: state.authorized === true, configured: state.configured === true, legacy: false };
  });
}

async function login(credentials) {
  await page.locator('#license-nav').click();
  await page.locator('#license-form').waitFor();
  await page.locator('#license-form [name=account]').fill(credentials.account);
  await page.locator('#license-form [name=password]').fill(credentials.password);
  const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/license/activate' && r.request().method() === 'POST');
  await page.locator('#license-form button[type=submit]').click();
  const response = await pending;
  if (!response.ok()) {
    const body = await response.json().catch(() => ({}));
    await page.locator('#license-error').waitFor().catch(() => {});
    await capture('真实登录失败');
    throw new Error(`真实登录失败：HTTP ${response.status()} ${body.code || body.error?.code || ''} ${body.message || body.error?.message || ''}`);
  }
  await page.waitForFunction(() => document.querySelector('#license-state')?.textContent === '本机已授权');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#license-state')?.textContent === '本机已授权');
}

try {
  report.sourceHashes = {};
  for (const name of ['前端/工作台.html', '前端/应用.js', '前端/账号授权.js', '前端/样式.css',
    '前端/令牌.css', '前端/模型管理.css', '前端/精致工作台.css', '服务端/账号授权.mjs', '授权服务/应用.mjs']) {
    report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(project, name))).digest('hex');
  }
  let url = value('--url', 'http://127.0.0.1:5188/工作台.html');
  if (args.includes('--local-login')) {
    const { startLocalAcceptance } = await import('./电商AI内容工厂_隔离授权验收_v1.0.mjs');
    isolated = await startLocalAcceptance(project);
    url = isolated.url;
    report.isolatedDataDirectory = isolated.dataDirectory;
  }
  const parsed = new URL(url);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && !parsed.username && !parsed.password,
    '本脚本只连接本机服务');
  report.url = url;
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ channel: report.browser, headless: !args.includes('--headed') && !args.includes('--wait-login') });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => report.pageErrors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 400) report.httpErrors.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(document.querySelector('#license-state')?.textContent));
  let state = await licenseState();
  report.initialState = state;
  await page.locator('#license-nav').click();
  await capture(`授权页_${state.authorized ? '初始已授权' : '登录前'}_1440`);
  if (isolated) await login(isolated.credentials);
  else if (!state.authorized && args.includes('--wait-login')) {
    assert(state.configured && !state.legacy, '当前服务未配置新版授权中心，无法手动登录');
    console.log('请在已打开的浏览器中登录，最多等待5分钟；脚本不会保存密码。');
    await page.waitForFunction(() => document.querySelector('#license-state')?.textContent === '本机已授权', null, { timeout: 300000 });
  }
  state = await licenseState();
  report.authorized = state.authorized;
  if (isolated || args.includes('--require-authorized') || args.includes('--wait-login')) {
    assert(state.authorized && !state.legacy, '未获得新版服务真实授权；停止登录后验收，不模拟成功状态');
  }
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#license-nav').click();
    await checkLayout(`授权页 ${width}`);
    if (state.authorized) {
      assert(await page.locator('#license-form').isHidden(), '已登录仍显示登录表单');
      assert(await page.locator('#license-renew').isVisible(), '缺少刷新授权入口');
      assert(await page.locator('#license-logout').isVisible(), '缺少退出入口');
      assert(!(await page.locator('[data-view=production]').isDisabled()), '已登录生产导航仍禁用');
    }
    await capture(`授权页_${state.authorized ? '真实已登录' : state.legacy ? '旧服务' : '未授权'}_${width}`);
    await page.locator('[data-view=config]').click();
    await page.locator('#model-manager').waitFor();
    await checkLayout(`模型页 ${width}`);
    assert(await page.locator('.model-row.enabled').evaluateAll(es => es.every(e => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)')));
    const count = await page.locator('.model-row').count();
    await page.locator('#model-search').fill('不存在的模型-界面验收');
    await page.locator('#model-list .empty').waitFor();
    await page.locator('#model-search').fill('');
    assert.equal(await page.locator('.model-row').count(), count);
    await capture(`模型页_${width}`);
    await page.locator('#add-model').click();
    await page.locator('#model-editor[open]').waitFor();
    await page.locator('#model-editor input[name=name]').focus();
    await checkLayout(`模型弹窗 ${width}`);
    assert(await page.locator('#model-editor input[name=name]').evaluate(e => getComputedStyle(e).outlineStyle !== 'none'), '输入框无焦点环');
    await capture(`模型弹窗_${width}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#model-editor[open]').count(), 0);
    if (!(await page.locator('[data-view=production]').isDisabled())) {
      await page.locator('[data-view=production]').click();
      await page.locator('#production-view').waitFor();
      await checkLayout(`生产页 ${width}`);
      await capture(`生产页_${width}`);
    }
    console.log(`通过：${width}px`);
  }
  assert.deepEqual(report.pageErrors, [], '浏览器出现未捕获异常');
  if (report.authorized) assert.deepEqual(report.httpErrors, [], '新版授权验收出现HTTP错误');
  report.result = report.authorized ? '新版真实授权后的UI检查通过' : '基础UI检查通过；新版登录后验收未执行';
} catch (error) {
  report.result = '失败';
  report.failure = error.message;
  if (page && !page.isClosed()) await capture('失败现场').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  await isolated?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, '验收结果.json'), JSON.stringify(report, null, 2));
  console.log(report.result);
  if (report.failure) console.log(report.failure);
  console.log(`截图和报告：${output}`);
}
