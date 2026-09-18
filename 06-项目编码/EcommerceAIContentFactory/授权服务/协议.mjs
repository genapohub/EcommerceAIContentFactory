import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

/** 协议错误仅暴露稳定错误码和说明，不附带令牌正文。 */
export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 拒绝同一字节序列的非规范文本编码。 */
export function decodeBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('编码无效');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('编码无效');
  return bytes;
}

const claimsSchema = z.strictObject({
  iss: z.string(), aud: z.literal('ecommerce-ai-content-factory'),
  sub: z.string().uuid(), username: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/),
  account: z.string(), deviceId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  machineId: z.string().regex(/^[a-f0-9]{64}$/),
  ver: z.number().int().positive(), jti: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  iat: z.number().int().nonnegative(), nbf: z.number().int().nonnegative(), exp: z.number().int().positive(),
  expiresAt: z.number().int().positive(), refreshAfter: z.number().int().positive(),
});

/** 用固定 pin 验签；客户端须同时提供本机 deviceId/machineId，服务端另行查库绑定。 */
export function verifyLease(token, { publicKey, kid, issuer, deviceId, machineId, now = Date.now(), allowExpired = false }) {
  try {
    if (typeof token !== 'string' || token.length > 4096 || !Number.isSafeInteger(now)
      || typeof issuer !== 'string' || !issuer || typeof allowExpired !== 'boolean') throw new Error('输入无效');
    const pinnedKey = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey);
    if (pinnedKey.asymmetricKeyType !== 'ed25519') throw new Error('公钥类型无效');
    const actualKid = createHash('sha256').update(pinnedKey.export({ format: 'der', type: 'spki' })).digest('base64url');
    if (kid !== undefined && kid !== actualKid) throw new Error('pin 不一致');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('格式无效');
    z.strictObject({ alg: z.literal('EdDSA'), typ: z.literal('JWT'), kid: z.literal(actualKid) })
      .parse(JSON.parse(decodeBase64url(parts[0]).toString('utf8')));
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), pinnedKey, decodeBase64url(parts[2]))) {
      throw new Error('签名无效');
    }
    const claims = claimsSchema.parse(JSON.parse(decodeBase64url(parts[1]).toString('utf8')));
    const current = Math.floor(now / 1000);
    if (claims.iss !== issuer || claims.nbf !== claims.iat || claims.iat > current
      || claims.exp <= claims.iat || claims.exp - claims.iat > 300
      || claims.account !== claims.username || claims.expiresAt !== claims.exp * 1000
      || claims.refreshAfter <= claims.iat * 1000 || claims.refreshAfter >= claims.expiresAt) {
      throw new Error('声明无效');
    }
    if (!allowExpired && claims.exp <= current) throw new AuthError(401, 'LEASE_EXPIRED', '租约已过期，请重新在线授权');
    if ((deviceId !== undefined && claims.deviceId !== deviceId)
      || (machineId !== undefined && claims.machineId !== machineId)) {
      throw new AuthError(401, 'DEVICE_MISMATCH', '租约与当前设备不匹配');
    }
    return claims;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, 'INVALID_LEASE', '租约无效');
  }
}
