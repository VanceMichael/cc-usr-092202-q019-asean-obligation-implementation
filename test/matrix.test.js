import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, throwsCode } from './helpers.js';
import {
  draftTask, confirmTask, evaluateMember, evaluateEvidence,
  DomainError, indexCatalog,
} from '../src/matrix.js';

const { workspace, evaluations } = await loadFixture();

test('秘书处按条款生成六要素草稿，成员国确认本国事实', () => {
  const draft = draftTask(workspace.catalog, 'M-ETR');
  assert.equal(draft.confirmation, 'draft');
  for (const key of ['responsible_agencies', 'legal_amendment', 'technical_interface', 'budget', 'completion_evidence', 'exemption_id']) {
    assert.ok(key in draft, `草稿缺少要素 ${key}`);
  }
  assert.throws(() => confirmTask(draft), DomainError);

  const filled = {
    ...draft,
    responsible_agencies: [{ agency_code: 'X-CUS', role: '主管机关' }],
    legal_amendment: { instrument: '某法修订', status: 'in_force', effective_date: '2026-06-01', gazette_ref: 'X-1' },
    technical_interface: { system: '某系统', status: 'live', go_live_date: '2026-06-10', spec_ref: 'X-IF' },
    budget: { status: 'allocated', line: 'L1', amount_local: 1, currency: 'X' },
    completion_evidence: ['EV-X-1'],
  };
  assert.equal(confirmTask(filled).confirmation, 'confirmed');

  // 引用未登记豁免不得确认
  assert.throws(
    () => confirmTask({ ...filled, exemption_id: 'EX-GHOST' }, { exemptions: [] }),
    /exemption_id.unregistered/,
  );
});

test('新加坡：已生效措施落实；DEFA-12 未生效仅为国内就绪', () => {
  const etr = evaluations.SGP.get('M-ETR');
  assert.equal(etr.implemented, true);
  assert.equal(etr.state, 'implemented');

  const esig = evaluations.SGP.get('M-ESIG');
  assert.equal(esig.implemented, false);
  assert.equal(esig.ready_pending_entry, true);
  assert.equal(esig.state, 'ready_pending_entry');
  assert.equal(esig.gates.article.pass, false);
  assert.equal(esig.gates.legal.pass, false, '颁布待施行不算法律门通过');
  assert.equal(esig.gates.legal_readiness.pass, true);
});

test('文莱：预裁定证据退回后以新材料获接受，措施算落实且退回史保留', () => {
  const acf = evaluations.BRN.get('M-ACF');
  assert.equal(acf.implemented, true);
  const old = workspace.members.BRN.evidence.evidence.find((e) => e.id === 'EV-BRN-ACF-1');
  assert.equal(old.reviews[0].decision, 'returned');
  assert.ok(old.reviews[0].reason.length > 10, '退回原因保留');
});

test('文莱：平台门户 UAT 未完成且有阻断性豁免，不落实', () => {
  const plt = evaluations.BRN.get('M-PLT');
  assert.equal(plt.implemented, false);
  const gates = plt.reasons.map((r) => r.gate);
  assert.ok(gates.includes('technical'));
  assert.ok(gates.includes('exemption'));
});

test('文莱：AEO 技术未建成、预算待批、证据缺失、豁免阻断', () => {
  const aeo = evaluations.BRN.get('M-AEO');
  assert.equal(aeo.implemented, false);
  const codes = aeo.reasons.map((r) => r.code);
  assert.ok(codes.includes('TECHNICAL_BUILD'));
  assert.ok(codes.includes('BUDGET_REQUESTED'));
  assert.ok(codes.includes('EVIDENCE_MISSING'));
  assert.ok(codes.includes('BLOCKING_EXEMPTION'));
});

test('泰国：平台措施法律生效且系统上线，但证据待审，不得算落实', () => {
  const plt = evaluations.THA.get('M-PLT');
  assert.equal(plt.implemented, false);
  const evidence = plt.reasons.find((r) => r.gate === 'evidence');
  assert.equal(evidence.code, 'EVIDENCE_PENDING_REVIEW');
});

test('泰国：DEFA-12 未生效且国内仍在立法，状态为 planned', () => {
  const esig = evaluations.THA.get('M-ESIG');
  assert.equal(esig.implemented, false);
  assert.equal(esig.ready_pending_entry, false);
  assert.equal(esig.state, 'planned');
});

test('前置措施递归：三国单一窗口均以预裁定落实为前提', () => {
  for (const member of ['BRN', 'SGP', 'THA']) {
    assert.equal(evaluations[member].get('M-DSE').implemented, true, `${member} M-DSE`);
  }
});

test('证据门：最新材料被接受即通过，旧退回不阻断；最新退回则不通过', () => {
  const doc = {
    evidence: [
      { id: 'A', submitted_at: '2026-01-01', reviews: [{ decision: 'returned', reason: '材料不足材料不足' }] },
      { id: 'B', submitted_at: '2026-02-01', reviews: [{ decision: 'accepted', reason: null }] },
      { id: 'C', submitted_at: '2026-03-01', reviews: [] },
    ],
  };
  assert.equal(evaluateEvidence(doc, ['A', 'B']).pass, true);
  const pending = evaluateEvidence(doc, ['B', 'C']);
  assert.equal(pending.pass, false);
  assert.equal(pending.code, 'EVIDENCE_PENDING_REVIEW');
});

test('前置依赖成环时报错', () => {
  const catalog = {
    agreements: [{ code: 'A', articles: [{ code: 'A1', status: 'in_force' }] }],
    measures: [
      { code: 'X', article: 'A1', cross_border: false },
      { code: 'Y', article: 'A1', cross_border: false },
    ],
  };
  const docs = {
    profile: { member: 'ZZZ' },
    evidence: { evidence: [] },
    exemptions: { exemptions: [] },
    tasks: {
      tasks: [
        { measure_code: 'X', article: 'A1', confirmation: 'confirmed', prerequisites: ['Y'],
          legal_amendment: { status: 'in_force' }, technical_interface: { status: 'live' },
          budget: { status: 'allocated' }, completion_evidence: [] },
        { measure_code: 'Y', article: 'A1', confirmation: 'confirmed', prerequisites: ['X'],
          legal_amendment: { status: 'in_force' }, technical_interface: { status: 'live' },
          budget: { status: 'allocated' }, completion_evidence: [] },
      ],
    },
  };
  assert.throws(() => evaluateMember(docs, catalog), (err) => err.code === 'PREREQUISITE_CYCLE');
  indexCatalog(workspace.catalog); // 目录可重复索引
});
