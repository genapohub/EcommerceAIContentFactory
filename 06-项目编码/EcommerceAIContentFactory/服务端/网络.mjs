import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError, assert } from './错误.mjs';

export function isPublicAddress(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  if (net.isIP(ip) === 6) {
    const value = ip.toLowerCase();
    return /^[23][0-9a-f]{3}:/.test(value) && !/^(2001:(db8|0):|2002:)/.test(value);
  }
  return false;
}

export async function validateRemote(input, lookup = dns.lookup) {
  let url;
  try { url = new URL(input); } catch { throw new AppError('链接格式无效。'); }
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, '仅支持公开HTTP/HTTPS链接。');
  assert(!url.port || ['443', '80'].includes(url.port), '视频链接仅支持标准网页端口。');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  assert(!['localhost', 'metadata.google.internal'].includes(host), '不能读取本机或内网链接。');
  const records = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true });
  assert(records.length && records.every(r => isPublicAddress(r.address)), '不能读取本机、内网或保留地址。');
  return { url, record: records[0] };
}

// Resolve and pin each redirect target to prevent a public hostname rebinding to a local service.
export async function downloadPublic(input, { maxBytes = 100 * 1024 * 1024, redirects = 4 } = {}) {
  const { url, record } = await validateRemote(input);
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, {
      headers: { 'User-Agent': 'ContentFactory/2.0', Accept: '*/*' },
      lookup(_host, options, callback) {
        if (options.all) callback(null, [record]);
        else callback(null, record.address, record.family);
      },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!redirects || !response.headers.location) return reject(new AppError('链接重定向过多。'));
        downloadPublic(new URL(response.headers.location, url).href, { maxBytes, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new AppError(`无法读取素材（HTTP ${response.statusCode}），请上传文件。`, 422, 'REMOTE_MEDIA_FAILED'));
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new AppError('素材超过允许大小，请压缩后上传。')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers['content-type'] || '', url: url.href }));
    });
    request.setTimeout(45000, () => request.destroy(new AppError('素材链接读取超时，请上传文件。', 504)));
    request.on('error', error => reject(error instanceof AppError ? error : new AppError('素材链接暂时无法访问，请上传文件。', 422)));
  });
}

export async function providerJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 150000) });
  } catch {
    throw new AppError('模型服务连接中断，提交结果需要核对，避免重复扣费。', 502, 'PROVIDER_UNCERTAIN');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const reason = status === 401 || status === 403 ? '密钥无效或模型权限未开通'
      : status === 429 ? '额度不足或请求频率受限' : status === 400 ? '模型未接受素材或参数，请核对模型权限及素材要求' : '模型服务暂时不可用';
    throw new AppError(`${reason}（HTTP ${status}）。`, 502, `PROVIDER_${status}`);
  }
  return body;
}
