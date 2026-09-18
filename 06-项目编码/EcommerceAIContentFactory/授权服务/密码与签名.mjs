import {
  createHash, createPublicKey, randomBytes, scrypt, sign, timingSafeEqual, verify,
} from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AuthError, decodeBase64url } from './协议.mjs';
export { AuthError, verifyLease } from './协议.mjs';

const derive = promisify(scrypt);
const passwordOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const usernameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/);
export const passwordSchema = z.string().min(12).max(128)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 256 && !/[\x00-\x1f\x7f]/.test(value));
export const encodedKeySchema = z.string().regex(/^[A-Za-z0-9_-]{59}$/);
export const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
export const machineIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** 校验 Ed25519 SPKI 公钥，以标准 DER 摘要作为唯一设备标识。 */
export function parseDeviceKey(encoded) {
  try {
    encodedKeySchema.parse(encoded);
    const der = decodeBase64url(encoded);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519'
      || !key.export({ format: 'der', type: 'spki' }).equals(der)) throw new Error('类型无效');
    return { key, deviceId: createHash('sha256').update(der).digest('base64url') };
  } catch {
    throw new AuthError(400, 'INVALID_DEVICE_KEY', '设备公钥必须为规范的 Ed25519 SPKI DER/base64url');
  }
}

/** 每个账号使用独立随机盐和固定成本的 scrypt。 */
export async function hashPassword(password) {
  passwordSchema.parse(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 32, passwordOptions);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** 未知账号同样执行 scrypt，使用恒定时间比较。 */
export async function checkPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$1') return false;
  const expected = decodeBase64url(parts[5]);
  const actual = await derive(password, decodeBase64url(parts[4]), 32, passwordOptions);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 导出可缓存的公钥，kid 随签名公钥变化。 */
export function signingIdentity(privateKey) {
  if (privateKey?.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('签名密钥必须是 Ed25519 私钥');
  }
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const kid = createHash('sha256').update(der).digest('base64url');
  return { publicKey, kid, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' } };
}

/** 生成标准 compact JWS，私钥只停留在调用方内存中。 */
export function signLease(payload, privateKey, kid) {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

/** 仅接受指定公钥对服务端原始挑战文本生成的 Ed25519 签名。 */
export function verifyDeviceSignature(publicKey, signingInput, signature) {
  try {
    return verify(null, Buffer.from(signingInput, 'utf8'), parseDeviceKey(publicKey).key,
      decodeBase64url(signature));
  } catch {
    return false;
  }
}
