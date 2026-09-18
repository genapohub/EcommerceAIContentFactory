import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './错误.mjs';

export function acquireInstance(directory) {
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, '服务锁.json');
  const token = randomUUID();
  const value = JSON.stringify({ pid: process.pid, token });
  try { writeFileSync(filename, value, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let existing;
    try { existing = JSON.parse(readFileSync(filename, 'utf8')); }
    catch { throw new AppError('服务锁无法读取，请确认没有运行实例后检查运行数据/服务锁.json。'); }
    let alive = true;
    try { process.kill(existing.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new AppError('同一数据目录已有服务运行，请使用已打开的工作台。');
    unlinkSync(filename);
    writeFileSync(filename, value, { flag: 'wx' });
  }
  return () => {
    try { if (JSON.parse(readFileSync(filename, 'utf8')).token === token) unlinkSync(filename); } catch {}
  };
}
