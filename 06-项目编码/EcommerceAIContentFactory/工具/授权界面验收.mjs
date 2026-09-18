import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAuthorizationApp } from '../授权服务/应用.mjs';
import { createApplication, root } from '../服务端/应用.mjs';
import { createLicenseClient } from '../服务端/账号授权.mjs';
import { createDeviceIdentity } from '../服务端/设备身份.mjs';

const directory = path.join(root, '验收输出', `设备授权-${Date.now()}`);
const screenshots = path.resolve(root, '../../05-UI设计/验收截图');
await mkdir(directory, { recursive: true }); await mkdir(screenshots, { recursive: true });
const password = randomBytes(24).toString('base64url');
const keys = generateKeyPairSync('ed25519');
const publicFile = path.join(directory, '授权公钥.pem');
await writeFile(publicFile, keys.publicKey.export({ type: 'spki', format: 'pem' }));

async function listen(server, port) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
const authorityServer = createServer();
const authorityUrl = await listen(authorityServer, Number(process.env.FACTORY_ACCEPTANCE_AUTH_PORT || 5192));
const authority = createAuthorizationApp({ databasePath: path.join(directory, '验收账号.sqlite'), signingKey: keys.privateKey, issuer: authorityUrl, mode: 'demo',
  rateLimit: { ip: 1000, account: 100, windowMs: 60000 } });
authorityServer.on('request', authority.app);
await authority.store.createAccount('local_validation', password);
const license = createLicenseClient({ directory: path.join(directory, '工作台'), env: { FACTORY_LICENSE_URL: authorityUrl, FACTORY_LICENSE_PUBLIC_KEY_FILE: publicFile },
  identityFactory: () => createDeviceIdentity({ directory: path.join(directory, '设备身份') }) });
const app = createApplication({ dataDir: path.join(directory, '工作台'), env: {}, license });
const appServer = createServer(app.app); const url = await listen(appServer, Number(process.env.FACTORY_ACCEPTANCE_PORT || 5191));
let browser;
async function close() {
  await browser?.close().catch(() => {});
  await new Promise(resolve => appServer.close(resolve)); await app.close();
  await new Promise(resolve => authorityServer.close(resolve)); authority.close();
}
try {
  const modulePath = process.env.FACTORY_PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(modulePath));
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('#license-form').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(screenshots, '设备授权_桌面激活.png'), fullPage: true });
  await page.locator('#license-form [name=account]').fill('local_validation');
  await page.locator('#license-form [name=password]').fill('WrongPassword123!');
  await page.locator('#license-form button[type=submit]').click();
  await page.locator('#license-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#license-error').textContent(), /账号或密码/);
  await page.locator('#license-form [name=password]').fill(password);
  await page.locator('#license-form button[type=submit]').click();
  await page.locator('#production-view').waitFor({ state: 'visible' });
  await page.locator('[data-view=config]').click(); await page.locator('#model-manager').waitFor({ state: 'visible' });
  for (const name of ['验收模型 A', '验收模型 B']) {
    await page.locator('#add-model').click();
    await page.locator('#model-editor-form [name=name]').fill(name);
    await page.locator('#save-model').click(); await page.locator('#model-editor').waitFor({ state: 'hidden' });
    await page.waitForFunction(expected => document.querySelector('.model-row h3')?.textContent === expected, name);
  }
  await page.locator('.model-row').filter({ hasText: '验收模型 A' }).locator('[data-model-edit]').click();
  await page.locator('#model-editor-form [name=name]').fill('最近编辑的模型');
  await page.locator('#save-model').click();
  await page.waitForFunction(() => document.querySelector('.model-row h3')?.textContent === '最近编辑的模型');
  await page.screenshot({ path: path.join(screenshots, '国内模型_v2.1桌面.png'), fullPage: true });
  await page.locator('#add-model').click();
  await page.screenshot({ path: path.join(screenshots, '国内模型_v2.1新增弹窗.png'), fullPage: true });
  await page.locator('#close-model-editor').click();
  await page.locator('#license-nav').click();
  assert.equal(await page.locator('#license-state').textContent(), '本机已授权');
  const downloadEvent = page.waitForEvent('download'); await page.locator('#license-export-device').click();
  assert.equal((await downloadEvent).suggestedFilename(), '设备换机申请.json');
  await page.locator('#license-renew').click(); await page.getByText('本机授权已更新', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshots, '设备授权_桌面已激活.png'), fullPage: true });
  const checks = [];
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['config', 'license', 'production']) {
      await page.locator(`[data-view=${view}]`).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${view}发生横向溢出`);
      if (width === 375) await page.screenshot({ path: path.join(screenshots, `v2.1手机_${view}.png`), fullPage: true });
      checks.push(`${width}px:${view}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('[data-view=config]').click();
  await page.locator('#model-search').fill('最近编辑'); assert.equal(await page.locator('.model-row').count(), 1);
  await page.locator('#model-search').fill('');
  await page.locator('#license-nav').click();
  page.once('dialog', dialog => dialog.accept()); await page.locator('#license-logout').click();
  await page.locator('#license-form').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-view=production]').isDisabled(), true);
  await page.locator('#license-form [name=account]').fill('local_validation');
  await page.locator('#license-form [name=password]').fill(password);
  await page.locator('#license-form button[type=submit]').click();
  await page.locator('#production-view').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  const report = { url, authorityUrl, directory, deviceProtection: 'Windows DPAPI CurrentUser，实际调用', checks, browserErrors: errors,
    passed: ['未激活锁定', '错误密码提示', '真实登录激活', '新增/编辑模型置顶', '搜索', '弹窗', '刷新授权', '下载换机申请', '退出后锁定', '同机再次登录'], paidModelCalls: 0 };
  await writeFile(path.join(directory, '界面验收结果.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close(); browser = undefined;
  if (!process.argv.includes('--keep-open')) await close();
  else { process.once('SIGINT', () => close().then(() => process.exit())); process.once('SIGTERM', () => close().then(() => process.exit())); }
} catch (error) { await close(); console.error(error.message); process.exitCode = 1; }
