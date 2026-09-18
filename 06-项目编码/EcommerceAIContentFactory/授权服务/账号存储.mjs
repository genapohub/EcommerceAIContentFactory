import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { AuthError, hashPassword, parseDeviceKey, usernameSchema, machineIdSchema } from './密码与签名.mjs';

/** 独立授权数据库，不连接主应用数据；同库多进程通过 SQLite 写锁串行化。 */
export function openAccountStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      device_key TEXT,
      device_id TEXT,
      machine_id TEXT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0, 1)),
      CHECK((device_key IS NULL) = (device_id IS NULL)),
      CHECK((device_key IS NULL) = (machine_id IS NULL))
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      account_id TEXT,
      account_version INTEGER NOT NULL,
      device_key TEXT NOT NULL,
      device_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('login', 'refresh')),
      signing_input TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS challenge_expiry ON challenges(expires_at);
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(reset_at);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY,
      action TEXT NOT NULL,
      account_id TEXT NOT NULL,
      at INTEGER NOT NULL
    );
  `);

  /** 不在事务内 await；业务拒绝以返回值提交，确保失败挑战也被消费。 */
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      if (result?.then) throw new Error('事务不允许异步回调');
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  /** 管理员创建账号；无 HTTP 注册入口。 */
  async function createAccount(username, password) {
    usernameSchema.parse(username);
    const passwordHash = await hashPassword(password);
    return transaction(() => {
      if (db.prepare('SELECT id FROM accounts WHERE username = ?').get(username)) {
        throw new AuthError(409, 'ACCOUNT_EXISTS', '账号已存在');
      }
      const id = randomUUID();
      db.prepare('INSERT INTO accounts(id, username, password_hash) VALUES (?, ?, ?)')
        .run(id, username, passwordHash);
      db.prepare('INSERT INTO admin_audit(action, account_id, at) VALUES (?, ?, ?)')
        .run('create', id, Date.now());
      return { accountId: id, username };
    });
  }

  /** 吊销账号或直接绑定管理员指定的新公钥；不开放空绑定窗口。 */
  function administer(username, newPublicKey, machineId) {
    usernameSchema.parse(username);
    const newDevice = newPublicKey === undefined ? null : parseDeviceKey(newPublicKey);
    if (newDevice) machineIdSchema.parse(machineId);
    return transaction(() => {
      const account = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
      if (!account) throw new AuthError(404, 'ACCOUNT_NOT_FOUND', '账号不存在');
      if (newDevice) {
        db.prepare(`UPDATE accounts SET device_key = ?, device_id = ?, machine_id = ?, version = version + 1,
          revoked = 0 WHERE id = ?`).run(newPublicKey, newDevice.deviceId, machineId, account.id);
      } else {
        db.prepare('UPDATE accounts SET revoked = 1, version = version + 1 WHERE id = ?').run(account.id);
      }
      db.prepare('DELETE FROM challenges WHERE username = ?').run(username);
      db.prepare('INSERT INTO admin_audit(action, account_id, at) VALUES (?, ?, ?)')
        .run(newDevice ? 'rebind' : 'revoke', account.id, Date.now());
      return { username, action: newDevice ? 'rebind' : 'revoke', deviceId: newDevice?.deviceId ?? null,
        machineId: newDevice ? machineId : null };
    });
  }

  /** SQLite 中共享限流状态，重启或切换工作进程不会重置当前窗口。 */
  function takeRateLimit(scope, value, limit, windowMs, now) {
    const bucket = createHash('sha256').update(`${scope}:${value}`).digest('hex');
    return transaction(() => {
      db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);
      const row = db.prepare('SELECT count, reset_at FROM rate_limits WHERE bucket = ?').get(bucket);
      if (row && row.count >= limit) return Math.max(1, Math.ceil((row.reset_at - now) / 1000));
      if (!row && db.prepare('SELECT COUNT(*) AS count FROM rate_limits').get().count >= 20000) return 60;
      db.prepare(`INSERT INTO rate_limits(bucket, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET count = count + 1`).run(bucket, now + windowMs);
      return 0;
    });
  }

  return {
    db, transaction, createAccount, takeRateLimit,
    revokeAccount: (username) => administer(username),
    rebindAccount: (username, publicKey, machineId) => administer(username, publicKey, machineId),
    close: () => db.close(),
  };
}
