import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './错误.mjs';

const collections = new Set(['projects', 'assets', 'jobs', 'settings']);

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, '内容工厂.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  for (const table of collections) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, document TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  }
  function tableName(table) {
    if (!collections.has(table)) throw new Error('Unknown collection');
    return table;
  }
  function get(table, id) {
    const row = db.prepare(`SELECT document FROM ${tableName(table)} WHERE id=?`).get(id);
    return row ? JSON.parse(row.document) : null;
  }
  function save(table, item) {
    const now = new Date().toISOString();
    const record = { ...item, id: item.id || randomUUID(), createdAt: item.createdAt || now, updatedAt: now };
    db.prepare(`INSERT INTO ${tableName(table)} VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at`)
      .run(record.id, JSON.stringify(record), record.createdAt, now);
    return record;
  }
  return {
    directory, get, save,
    require(table, id) {
      const item = get(table, id);
      if (!item) throw new AppError('记录不存在。', 404, 'NOT_FOUND');
      return item;
    },
    list(table, predicate = () => true) {
      return db.prepare(`SELECT document FROM ${tableName(table)} ORDER BY created_at DESC`).all()
        .map(row => JSON.parse(row.document)).filter(predicate);
    },
    remove(table, id) { db.prepare(`DELETE FROM ${tableName(table)} WHERE id=?`).run(id); },
    removeProject(id) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!get('projects', id)) throw new AppError('商品项目不存在。', 404, 'NOT_FOUND');
        const pending = db.prepare("SELECT id FROM jobs WHERE json_extract(document, '$.projectId')=? AND json_extract(document, '$.status') IN ('queued','running','needs_review') LIMIT 1").get(id);
        if (pending) throw new AppError('项目有运行中或待核对的任务，请处理完成后再删除。', 409, 'PROJECT_BUSY');
        for (const table of ['assets', 'jobs']) db.prepare(`DELETE FROM ${table} WHERE json_extract(document, '$.projectId')=?`).run(id);
        db.prepare('DELETE FROM projects WHERE id=?').run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
