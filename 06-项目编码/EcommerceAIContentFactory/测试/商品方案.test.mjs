import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../服务端/存储.mjs';
import { createProjects, draftPlan, planSchema } from '../服务端/项目.mjs';

test('合法的长商品资料可以生成可编辑草稿，原始资料不丢失', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'factory-long-fields-'));
  const store = createStore(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const projects = createProjects(store, { public: value => value });
  const fields = { name: '商品'.repeat(50), specs: '规格参数'.repeat(500), claims: '已确认的可见结构'.repeat(250) };
  const created = projects.create({ fields });
  assert.equal(planSchema.safeParse(created.plan).success, true);
  assert.equal(created.fields.name, fields.name);
  assert.equal(created.fields.specs, fields.specs);
  assert.equal(created.fields.claims, fields.claims);
  assert.equal(created.plan.screens[0].copy, fields.name);
  assert.match(created.plan.screens[4].copy, /…$/);
  const updated = projects.update(created.id, { fields: { ...created.fields, price: '129元' } });
  assert.equal(updated.fields.price, '129元');
  assert.equal(updated.fields.specs, fields.specs);
  assert.equal(planSchema.safeParse(updated.plan).success, true);
});

test('多个长卖点生成的详情正文仍满足可编辑方案约束', () => {
  const claims = Array.from({ length: 6 }, (_, index) => `${index}${'已确认描述'.repeat(55)}`).join('；');
  const plan = draftPlan({ claims });
  assert.equal(planSchema.safeParse(plan).success, true);
  assert.equal(plan.points.length, 6);
  assert.equal(plan.points.every(point => point.proof === ''), true);
});
