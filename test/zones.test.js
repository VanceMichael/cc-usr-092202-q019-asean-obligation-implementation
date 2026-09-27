import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseZone, can, assertAccess, PermissionError,
  readZonedJson, writeZonedJson, loadWorkspace, zoneDir,
} from '../src/zones.js';

const ZONE_ROOT = new URL('../fixtures/zones/', import.meta.url);

test('分区标识解析', () => {
  assert.deepEqual(parseZone('public'), { kind: 'public' });
  assert.deepEqual(parseZone('secretariat'), { kind: 'secretariat' });
  assert.deepEqual(parseZone('member:SGP'), { kind: 'member', member: 'SGP' });
  assert.throws(() => parseZone('member:sg'), /成员国分区标识无效/);
  assert.throws(() => parseZone('other'), /未知分区/);
});

test('成员国只能读写本国分区', () => {
  assert.equal(can('member:SGP', 'member:SGP', 'read'), true);
  assert.equal(can('member:SGP', 'member:SGP', 'write'), true);
  assert.equal(can('member:SGP', 'member:BRN', 'read'), false);
  assert.equal(can('member:SGP', 'member:BRN', 'write'), false);
  assert.equal(can('member:SGP', 'public', 'read'), true);
  assert.equal(can('member:SGP', 'public', 'write'), false);
  assert.equal(can('member:SGP', 'secretariat', 'read'), false);
});

test('秘书处可读全部、写公共区与秘书处区，不能写成员事实', () => {
  assert.equal(can('secretariat', 'member:BRN', 'read'), true);
  assert.equal(can('secretariat', 'member:BRN', 'write'), false);
  assert.equal(can('secretariat', 'public', 'write'), true);
  assert.equal(can('secretariat', 'secretariat', 'write'), true);
});

test('审查人员只读；企业与发布人员只能读公共区', () => {
  assert.equal(can('reviewer', 'member:THA', 'read'), true);
  assert.equal(can('reviewer', 'member:THA', 'write'), false);
  for (const role of ['enterprise', 'publisher']) {
    assert.equal(can(role, 'public', 'read'), true);
    assert.equal(can(role, 'member:THA', 'read'), false);
    assert.equal(can(role, 'secretariat', 'read'), false);
  }
});

test('越权读取直接拒绝', async () => {
  await assert.rejects(
    () => readZonedJson(ZONE_ROOT, 'member:BRN', 'tasks.json', 'enterprise'),
    PermissionError,
  );
  await assert.rejects(
    () => readZonedJson(ZONE_ROOT, 'member:BRN', 'tasks.json', 'member:SGP'),
    PermissionError,
  );
});

test('授权读取与受控写入（临时目录）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zones-'));
  await writeZonedJson(root, 'member:BRN', 'profile.json', { member: 'BRN', zone: 'member:BRN' }, 'member:BRN');
  const back = await readZonedJson(root, 'member:BRN', 'profile.json', 'member:BRN');
  assert.equal(back.member, 'BRN');
  // 其他成员无法写入同一分区
  await assert.rejects(
    () => writeZonedJson(root, 'member:BRN', 'profile.json', {}, 'member:SGP'),
    PermissionError,
  );
  // 企业无法写入公共区
  await assert.rejects(
    () => writeZonedJson(root, 'public', 'x.json', {}, 'enterprise'),
    PermissionError,
  );
  assert.ok(zoneDir(root, 'member:THA').endsWith('member-tha'));
});

test('秘书处加载整库并校验分区归属', async () => {
  const ws = await loadWorkspace(ZONE_ROOT, 'secretariat');
  assert.deepEqual(Object.keys(ws.members).sort(), ['BRN', 'SGP', 'THA']);
  assert.equal(ws.catalog.measures.length, 6);
  assert.ok(ws.secretariat.thresholds.thresholds.length >= 1);
  // 企业不能加载整库
  await assert.rejects(() => loadWorkspace(ZONE_ROOT, 'enterprise'), PermissionError);
});

test('assertAccess 对未知角色拒绝', () => {
  assert.throws(() => assertAccess('minister', 'public', 'read'), PermissionError);
});
