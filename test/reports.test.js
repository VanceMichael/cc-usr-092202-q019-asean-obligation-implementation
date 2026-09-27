import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, throwsCode } from './helpers.js';
import {
  buildQuarterlyReport, validateUpdate, latestReportedStates,
} from '../src/reports.js';
import { reviewEvidence, returnedEvidence, isAccepted } from '../src/review.js';

const { workspace } = await loadFixture();
const knownMeasures = new Map(workspace.catalog.measures.map((m) => [m.code, m]));
const ctxInForce = { articleStatus: 'in_force', knownMeasures };

test('已生效条款可报已落实，但必须附证据', () => {
  assert.doesNotThrow(() => validateUpdate(
    { measure_code: 'M-ETR', state: 'implemented', evidence_ids: ['EV-1'], change: null, reason: null },
    ctxInForce,
  ));
  throwsCode(
    () => validateUpdate({ measure_code: 'M-ETR', state: 'implemented', evidence_ids: [] }, ctxInForce),
    'EVIDENCE_REQUIRED',
  );
});

test('未生效条款不得标成已落实，只能登记为国内就绪', () => {
  const ctxPending = { articleStatus: 'not_in_force', knownMeasures };
  throwsCode(
    () => validateUpdate({ measure_code: 'M-ESIG', state: 'implemented', evidence_ids: ['EV-1'] }, ctxPending),
    'ARTICLE_NOT_IN_FORCE',
  );
  assert.doesNotThrow(() => validateUpdate(
    { measure_code: 'M-ESIG', state: 'ready_pending_entry', evidence_ids: ['EV-1'], reason: '条款尚未生效条款尚未生效' },
    ctxPending,
  ));
});

test('计划调整、期限延长、部分完成均须保留原因', () => {
  throwsCode(
    () => validateUpdate({ measure_code: 'M-AEO', state: 'planned', change: 'extension', reason: '延期' }, ctxInForce),
    'REASON_REQUIRED',
  );
  throwsCode(
    () => validateUpdate({
      measure_code: 'M-AEO', state: 'planned', change: 'extension',
      reason: '接口招标流标接口招标流标', previous_deadline: '2026-09-30', revised_deadline: '2026-09-15',
    }, ctxInForce),
    'DEADLINE_NOT_EXTENDED',
  );
  assert.doesNotThrow(() => validateUpdate({
    measure_code: 'M-AEO', state: 'planned', change: 'extension',
    reason: '接口招标流标接口招标流标', previous_deadline: '2026-09-30', revised_deadline: '2027-03-31',
  }, ctxInForce));
  throwsCode(
    () => validateUpdate({ measure_code: 'M-PLT', state: 'partial', reason: '未完' }, ctxInForce),
    'PARTIAL_REASON_REQUIRED',
  );
});

test('整季回报：空回报与重复措施被拒绝', () => {
  throwsCode(() => buildQuarterlyReport('SGP', '2026Q4', '2026-10-05', [], ctxInForce), 'EMPTY_REPORT');
  throwsCode(() => buildQuarterlyReport('SGP', '2026Q4', '2026-10-05', [
    { measure_code: 'M-ETR', state: 'in_progress', change: null, reason: null },
    { measure_code: 'M-ETR', state: 'in_progress', change: null, reason: null },
  ], ctxInForce), 'DUPLICATE_UPDATE');
});

test('文莱历史回报保留全部变更与原因，并取最新季度状态', () => {
  const { latest, history } = latestReportedStates(workspace.members.BRN.reports);
  assert.equal(latest.get('M-PLT').change, 'plan_adjustment');
  assert.ok(latest.get('M-PLT').reason.includes('平台分类字典'));
  assert.equal(latest.get('M-AEO').change, 'extension');
  assert.equal(latest.get('M-AEO').revised_deadline, '2027-03-31');
  // 上一季度的部分完成记录仍在历史中
  const prevPlat = history.find((h) => h.quarter === '2026Q2' && h.measure_code === 'M-PLT');
  assert.equal(prevPlat.change, 'partial_completion');
  assert.ok(prevPlat.reason.includes('用户验收测试'));
});

test('证据退回必须写原因；新材料接受后旧退回史保留', () => {
  const doc = structuredClone(workspace.members.BRN.evidence);
  throwsCode(
    () => reviewEvidence(doc, 'EV-BRN-DSE-1', { by: '审查人员', at: '2026-09-25', decision: 'returned', reason: '不行' }),
    'RETURN_REASON_REQUIRED',
  );
  const ev = reviewEvidence(doc, 'EV-BRN-DSE-1', {
    by: '审查人员', at: '2026-09-25', decision: 'returned', reason: '报文签名算法不符合规范报文签名算法不符合规范',
  });
  assert.equal(ev.reviews.length, 2, '审查结论追加而非覆盖');
  assert.equal(isAccepted(ev), false);
  // 样例中文莱预裁定首版退回、次版接受
  const returned = returnedEvidence(workspace.members.BRN.evidence).map((e) => e.id);
  assert.ok(!returned.includes('EV-BRN-ACF-2'));
});
