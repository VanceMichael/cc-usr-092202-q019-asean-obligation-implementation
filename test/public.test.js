import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixture } from './helpers.js';
import { allRecognitionChecks } from '../src/recognition.js';
import {
  buildPublicSummary, enterpriseMeasureView, enterpriseMemberView,
} from '../src/public.js';
import { writeZonedJson, readZonedJson } from '../src/zones.js';

const { workspace, evaluations } = await loadFixture();
const recognitionRows = allRecognitionChecks(workspace, evaluations);
const summary = buildPublicSummary(workspace, evaluations, recognitionRows, '2026-09-27');

test('秘书处生成公开摘要：已落实措施对企业显示可用及可用日期', () => {
  const etr = enterpriseMeasureView(summary, 'M-ETR');
  const byMember = Object.fromEntries(etr.by_member.map((e) => [e.member, e]));
  assert.equal(byMember.SGP.status, 'available');
  assert.equal(byMember.BRN.status, 'available');
  assert.equal(byMember.THA.status, 'available');
  // 文莱法律 2026-05-02 生效、系统 2026-06-10 上线 → 可用日期取较晚者
  assert.equal(byMember.BRN.available_from, '2026-06-10');
});

test('企业只看到具备法律与技术条件的状态：门户 UAT、证据待审均显示中性不可用', () => {
  const plt = enterpriseMeasureView(summary, 'M-PLT');
  const byMember = Object.fromEntries(plt.by_member.map((e) => [e.member, e]));
  assert.equal(byMember.SGP.status, 'available');
  assert.equal(byMember.BRN.status, 'not_available');
  assert.equal(byMember.THA.status, 'not_available', '证据待审不得提前公开为可用');
  assert.equal('available_from' in byMember.BRN, false, '不可用项不附预计时间');
});

test('未生效条款即便国内就绪，企业也只看到不可用', () => {
  const esig = enterpriseMeasureView(summary, 'M-ESIG');
  for (const row of esig.by_member) {
    assert.equal(row.status, 'not_available');
    assert.equal('available_from' in row, false);
  }
});

test('跨境措施：公开视图只出现互认门槛全部通过的成员对', () => {
  const aeo = enterpriseMeasureView(summary, 'M-AEO');
  assert.deepEqual(aeo.recognition_pairs.map((r) => r.pair), [['SGP', 'THA']]);
  assert.equal(aeo.recognition_pairs[0].conformity_ref, 'ASEAN-AEO-CERT-SGP-THA-2026-08');

  const dse = enterpriseMeasureView(summary, 'M-DSE');
  const pairs = dse.recognition_pairs.map((r) => r.pair.join('-')).sort();
  assert.deepEqual(pairs, ['BRN-SGP', 'SGP-THA']);
  assert.ok(!pairs.includes('BRN-THA'), '符合性未测的成员对不得出现');

  // 电子签名无任何成员对互认
  const esig = enterpriseMeasureView(summary, 'M-ESIG');
  assert.deepEqual(esig.recognition_pairs, []);
});

test('公开摘要不泄露任何内部信息', () => {
  const raw = JSON.stringify(summary);
  for (const secret of [
    'EX-BRN-PLT-SME', 'EX-AEO-BRN', // 豁免标识
    'extension', 'plan_adjustment', 'partial_completion', // 变更类型
    'BND', 'SGD', 'THB', 'amount_local', 'budget', // 预算
    'returned', '退回', 'EVIDENCE', // 证据审查
    'uat', 'pilot', 'build', // 内部建设阶段
    'reason', 'blocked', // 原因与阻断
  ]) {
    assert.ok(!raw.includes(secret), `公开摘要泄露内部字段: ${secret}`);
  }
});

test('企业成员视图同样只含中性状态', () => {
  const brn = enterpriseMemberView(summary, 'BRN');
  const aeo = brn.find((e) => e.measure_code === 'M-AEO');
  assert.equal(aeo.status, 'not_available');
  assert.deepEqual(Object.keys(aeo).sort(), ['cross_border', 'domains', 'measure_code', 'measure_title', 'status']);
});

test('公开摘要由秘书处写入公共区后，企业可读取但读不到成员分区', async () => {
  const root = await mkdtemp(join(tmpdir(), 'public-'));
  await writeZonedJson(root, 'public', 'summary.json', summary, 'secretariat');
  const seen = await readZonedJson(root, 'public', 'summary.json', 'enterprise');
  assert.equal(seen.doc, 'public_implementation_summary');
  await assert.rejects(
    () => readZonedJson(root, 'member:BRN', 'tasks.json', 'enterprise'),
    /无权读取分区/,
  );
});
