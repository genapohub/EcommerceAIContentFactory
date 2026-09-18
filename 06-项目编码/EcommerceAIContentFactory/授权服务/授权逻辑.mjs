import { randomBytes } from 'node:crypto';
import {
  AuthError, checkPassword, parseDeviceKey, signLease, verifyLease, verifyDeviceSignature,
} from './密码与签名.mjs';

const reject = (status, code, message) => new AuthError(status, code, message);

/** 授权事务与密码校验，不依赖 HTTP 请求/响应对象。 */
export function createAuthorizationService({ store, signingKey, identity, issuer, leaseSeconds, challengeSeconds, now }) {
  const { db, transaction } = store;
  let passwordChecks = 0;
  const dummyHash = `scrypt$32768$8$1$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`;

  /** 业务拒绝留到提交后抛出，确保失败签名也消费挑战。 */
  function complete(work) {
    const result = transaction(work);
    if (result instanceof AuthError) throw result;
    return result;
  }

  /** 挑战绑定硬件摘要、公钥摘要、用途和 origin，不泄露账号是否存在。 */
  function createChallenge(input) {
    const device = parseDeviceKey(input.devicePublicKey);
    return complete(() => {
      const current = now();
      db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(current);
      if (db.prepare('SELECT COUNT(*) AS count FROM challenges').get().count >= 10000) {
        return reject(503, 'SERVER_BUSY', '授权服务繁忙，请稍后重试');
      }
      const account = db.prepare('SELECT id, version FROM accounts WHERE username = ?').get(input.username);
      const challengeId = randomBytes(24).toString('base64url');
      const expiresAt = current + challengeSeconds * 1000;
      const signingInput = ['ecommerce-device-auth/v1', issuer, input.purpose, input.username,
        device.deviceId, input.machineId, challengeId, randomBytes(32).toString('base64url'), String(expiresAt)].join('\n');
      db.prepare(`INSERT INTO challenges(id, username, account_id, account_version, device_key,
        device_id, machine_id, purpose, signing_input, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(challengeId, input.username, account?.id ?? null, account?.version ?? 0,
          input.devicePublicKey, device.deviceId, input.machineId, input.purpose, signingInput, expiresAt);
      return { challengeId, signingInput, expiresAt };
    });
  }

  /** 写事务消费挑战；失败请求也不允许再次使用该挑战。 */
  function consumeChallenge(id, purpose, username, signature) {
    const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
    if (!challenge) return reject(401, 'CHALLENGE_INVALID', '挑战不存在或已使用');
    db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
    if (challenge.expires_at <= now()) return reject(401, 'CHALLENGE_EXPIRED', '挑战已过期');
    if (challenge.purpose !== purpose || challenge.username !== username) {
      return reject(401, 'CHALLENGE_INVALID', '挑战用途或账号不匹配');
    }
    if (!verifyDeviceSignature(challenge.device_key, challenge.signing_input, signature)) {
      return reject(401, 'DEVICE_PROOF_INVALID', '设备签名无效');
    }
    return challenge;
  }

  /** 签发发生在写锁内，与管理员吊销和换机串行。 */
  function issueLease(account, challenge) {
    const issued = Math.floor(now() / 1000);
    const expiresAt = (issued + leaseSeconds) * 1000;
    const refreshAfter = (issued + Math.floor(leaseSeconds / 2)) * 1000;
    const lease = signLease({
      iss: issuer, aud: 'ecommerce-ai-content-factory', sub: account.id, username: account.username,
      account: account.username, deviceId: challenge.device_id, machineId: challenge.machine_id,
      ver: account.version, jti: randomBytes(24).toString('base64url'),
      iat: issued, nbf: issued, exp: expiresAt / 1000, expiresAt, refreshAfter,
    }, signingKey, identity.kid);
    return { lease, expiresAt, refreshAfter, deviceId: challenge.device_id, machineId: challenge.machine_id };
  }

  /** 异步 scrypt 后持锁重读账号，阻断密码校验期间的管理员变更竞态。 */
  async function login(input) {
    if (passwordChecks >= 4) throw reject(503, 'SERVER_BUSY', '授权服务繁忙，请稍后重试');
    const before = db.prepare('SELECT password_hash FROM accounts WHERE username = ?').get(input.username);
    let passwordValid;
    passwordChecks++;
    try {
      passwordValid = await checkPassword(input.password, before?.password_hash ?? dummyHash);
    } finally {
      passwordChecks--;
    }
    return complete(() => {
      const challenge = consumeChallenge(input.challengeId, 'login', input.username, input.signature);
      if (challenge instanceof AuthError) return challenge;
      const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(input.username);
      if (!account || !passwordValid || account.password_hash !== before?.password_hash) {
        return reject(401, 'INVALID_CREDENTIALS', '账号或密码错误');
      }
      if (account.revoked) return reject(403, 'ACCOUNT_REVOKED', '账号已被管理员吊销');
      if (account.id !== challenge.account_id || account.version !== challenge.account_version) {
        return reject(401, 'CHALLENGE_INVALID', '账号授权已变更，请重新获取挑战');
      }
      if (account.device_id && (account.device_id !== challenge.device_id
        || account.device_key !== challenge.device_key || account.machine_id !== challenge.machine_id)) {
        return reject(409, 'DEVICE_ALREADY_BOUND', '账号已绑定其他设备，请联系管理员换机');
      }
      if (!account.device_id) {
        db.prepare(`UPDATE accounts SET device_key = ?, device_id = ?, machine_id = ?
          WHERE id = ? AND device_id IS NULL`)
          .run(challenge.device_key, challenge.device_id, challenge.machine_id, account.id);
      }
      return issueLease(account, challenge);
    });
  }

  /** 历史租约只在续期时允许过期，仍必须证明设备私钥持有。 */
  function readRefreshClaims(lease) {
    return verifyLease(lease, { ...identity, issuer, now: now(), allowExpired: true });
  }

  /** 在线重查状态、版本、公钥和硬件身份；没有客户端解绑路径。 */
  function refresh(input) {
    const claims = readRefreshClaims(input.lease);
    return complete(() => {
      const challenge = consumeChallenge(input.challengeId, 'refresh', claims.username, input.signature);
      if (challenge instanceof AuthError) return challenge;
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(claims.sub);
      if (!account || account.revoked || account.version !== claims.ver) {
        return reject(403, 'ACCOUNT_REVOKED', '账号授权已被管理员吊销或变更');
      }
      if (challenge.account_id !== account.id || challenge.account_version !== account.version) {
        return reject(401, 'CHALLENGE_INVALID', '账号授权已变更，请重新获取挑战');
      }
      if (account.username !== claims.username || account.device_id !== claims.deviceId
        || challenge.device_id !== claims.deviceId || account.device_key !== challenge.device_key
        || account.machine_id !== claims.machineId || challenge.machine_id !== claims.machineId) {
        return reject(409, 'DEVICE_ALREADY_BOUND', '当前设备与账号绑定不一致');
      }
      return issueLease(account, challenge);
    });
  }

  return { createChallenge, login, refresh, readRefreshClaims };
}
