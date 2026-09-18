import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import YAML from 'yaml';
import { root } from '../服务端/应用.mjs';
let count = 0;
for (const directory of ['服务端', '前端', '测试', '工具', '授权服务']) {
  for (const name of await readdir(path.join(root, directory))) {
    if (!/\.(m?js)$/.test(name)) continue;
    const filename = path.join(root, directory, name);
    execFileSync(process.execPath, ['--check', filename], { windowsHide: true }); count++;
  }
}
const html = await readFile(path.join(root, '前端/工作台.html'), 'utf8');
if (html.includes('type="password" required') || html.includes('本地引擎')) throw new Error('模型配置不符合规格');
const icons = await readFile(path.join(root, 'node_modules/lucide/dist/umd/lucide.js'), 'utf8');
if (!icons.length) throw new Error('图标文件缺失');
console.log(`${count} 个JS模块语法通过，静态依赖存在。`);
const contract = YAML.parse(await readFile(path.resolve(root, '../../03-技术文档/电商AI内容工厂_API_v2.0.yaml'), 'utf8'));
function verifyRefs(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    const found = value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], contract);
    if (!found) throw new Error(`接口契约引用不存在：${value.$ref}`);
  }
  Object.values(value).forEach(verifyRefs);
}
verifyRefs(contract);
console.log(`OpenAPI YAML和引用检查通过：${Object.keys(contract.paths).length}条路径，${Object.keys(contract.components.schemas).length}个数据定义。`);
