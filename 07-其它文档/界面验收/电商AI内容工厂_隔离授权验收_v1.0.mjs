import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

/** 使用当前源码、真实DPAPI与签名链路；独立数据库和随机端口，不读取5188业务数据。 */
export async function startLocalAcceptance(project) {
  const load = relative => import(pathToFileURL(path.join(project, relative)).href);
  const { createAuthorizationApp } = await load('授权服务/应用.mjs');
  const { createApplication } = await load('服务端/应用.mjs');
  const { createLicenseClient } = await load('服务端/账号授权.mjs');
  const { createDeviceIdentity } = await load('服务端/设备身份.mjs');
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), '电商UI授权验收-'));
  const appDirectory = path.join(dataDirectory, '工作台数据');
  await mkdir(appDirectory);
  const signing = generateKeyPairSync('ed25519');
  const publicKeyFile = path.join(dataDirectory, '授权公钥.pem');
  await writeFile(publicKeyFile, signing.publicKey.export({ format: 'pem', type: 'spki' }));
  let authority, application, authServer, appServer;
  const close = async () => {
    await closeServer(appServer);
    await closeServer(authServer);
    await application?.close();
    authority?.close();
  };
  try {
    authServer = createServer((req, res) => authority.app(req, res));
    const issuer = await listen(authServer);
    authority = createAuthorizationApp({ databasePath: path.join(dataDirectory, '验收账号.sqlite'),
      signingKey: signing.privateKey, issuer, mode: 'demo' });
    const credentials = { account: 'ui_acceptance', password: randomBytes(24).toString('base64url') };
    await authority.store.createAccount(credentials.account, credentials.password);
    const env = { FACTORY_LICENSE_URL: issuer, FACTORY_LICENSE_PUBLIC_KEY_FILE: publicKeyFile };
    const license = createLicenseClient({ directory: appDirectory, env,
      identityFactory: () => createDeviceIdentity({ directory: path.join(dataDirectory, '验收设备身份') }) });
    application = createApplication({ dataDir: appDirectory, env, license, startJobs: false });
    application.projects.create({ fields: { name: '界面验收商品', category: '家居' } });
    appServer = createServer(application.app);
    const url = await listen(appServer);
    return { url, credentials, dataDirectory, close };
  } catch (error) {
    await close();
    throw error;
  }
}
