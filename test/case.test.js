import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MatrixError, createSession, loadCaseFile } from '../src/index.js';

const CASE_PATH = fileURLToPath(new URL('../fixtures/case.json', import.meta.url));

async function freshCase() {
  return loadCaseFile(CASE_PATH);
}

async function session(role, memberId) {
  return createSession(await freshCase(), memberId ? { role, memberId } : { role });
}

test('案例资料装载与义务任务分解', async () => {
  const sec = await session('secretariat');
  const matrix = sec.matrix();
  const eco = matrix.find((o) => o.obligation_id === 'ob-asw-eco');
  assert.equal(eco.entry_into_force, 'in_force');
  const sg = eco.tasks.find((t) => t.member_id === 'SG');
  assert.equal(sg.effective_state, 'implemented');
  assert.equal(sg.authority.name, '新加坡关税局');
  assert.equal(sg.legal_revision.required, false);
  assert.equal(sg.technical_interface.conformance, 'passed');
  assert.equal(sg.exemption, null);
  assert.ok(sg.checks.every((c) => c.met));

  const id = eco.tasks.find((t) => t.member_id === 'ID');
  assert.equal(id.effective_state, 'in_progress');
  const tech = id.checks.find((c) => c.code === 'technical');
  assert.equal(tech.met, false);
  assert.match(tech.detail, /failed/);

  const kh = eco.tasks.find((t) => t.member_id === 'KH');
  assert.equal(kh.exemption.clause, 'ASW议定书第10条最不发达成员过渡期');
  assert.equal(kh.fact_confirmed, null);
});

test('未生效条款不得被标记为已落实，拒绝并留痕', async () => {
  const sg = await session('member', 'SG');
  const before = sg.listQuarterlyReports().length;
  await assert.throws(
    () => sg.recordQuarterlyReport({
      id: 'r-sg-esig-q3-blocked',
      task_id: 't-sg-esig',
      quarter: '2026Q3',
      submitted_at: '2026-09-20',
      claimed_status: 'implemented',
      changes: [],
    }),
    (err) => err instanceof MatrixError && err.code === 'IMPLEMENTATION_BLOCKED',
  );
  // 被阻断的申报不改变任务状态
  const matrix = sg.matrix();
  const esig = matrix.find((o) => o.obligation_id === 'ob-defa-07')
    .tasks.find((t) => t.task_id === 't-sg-esig');
  assert.equal(esig.effective_state, 'in_progress');
  assert.equal(sg.listQuarterlyReports().length, before);

  const sec = await session('secretariat');
  const fresh = await freshCase();
  // 装载时样例自带一条历史拒绝记录，代码为条款未生效
  assert.ok(fresh.rejected_intake.some((r) => r.rejected_code === 'ARTICLE_NOT_IN_FORCE'));
});

test('季度回报：原因强制、期限延长更新任务、越权回报被拒', async () => {
  const kh = await session('member', 'KH');
  await assert.throws(
    () => kh.recordQuarterlyReport({
      task_id: 't-kh-eco',
      quarter: '2026Q4',
      submitted_at: '2026-12-30',
      claimed_status: 'in_progress',
      changes: [{ kind: 'plan_adjusted', reason: '   ' }],
    }),
    (err) => err.code === 'REASON_REQUIRED',
  );

  const report = kh.recordQuarterlyReport({
    task_id: 't-kh-eco',
    quarter: '2026Q4',
    submitted_at: '2026-12-30',
    claimed_status: 'in_progress',
    changes: [{
      kind: 'deadline_extended',
      previous_deadline: '2027-06-30',
      new_deadline: '2027-09-30',
      reason: '立法会期顺延一个会期，秘书处已知会',
    }],
  });
  assert.equal(report.changes[0].reason.length > 0, true);
  const row = kh.matrix()
    .find((o) => o.obligation_id === 'ob-asw-eco')
    .tasks.find((t) => t.task_id === 't-kh-eco');
  assert.equal(row.deadline, '2027-09-30');

  const th = await session('member', 'TH');
  assert.throws(
    () => th.recordQuarterlyReport({
      task_id: 't-kh-eco',
      quarter: '2026Q4',
      submitted_at: '2026-12-30',
      claimed_status: 'in_progress',
      changes: [],
    }),
    (err) => err.code === 'FOREIGN_TASK_FORBIDDEN',
  );
});

test('证据退回在审计轨迹中保留原因', async () => {
  const sec = await session('secretariat');
  const trail = sec.taskAuditTrail('t-id-eco');
  const returned = trail.filter((e) => e.kind === 'evidence_returned');
  assert.ok(returned.length >= 1);
  assert.match(returned[0].reason, /签发机关/);

  const khTrail = sec.taskAuditTrail('t-kh-eco');
  assert.ok(khTrail.some((e) => e.kind === 'deadline_extended' && e.detail.new_deadline === '2027-06-30'));
  assert.ok(khTrail.some((e) => e.kind === 'partially_complete'));
});

test('成员只能确认本国事实', async () => {
  const kh = await session('member', 'KH');
  kh.confirmOwnFact('t-kh-eco', '2026-09-22');
  const row = kh.matrix()
    .find((o) => o.obligation_id === 'ob-asw-eco')
    .tasks.find((t) => t.task_id === 't-kh-eco');
  assert.equal(row.fact_confirmed.by_member, 'KH');

  const th = await session('member', 'TH');
  assert.throws(() => th.confirmOwnFact('t-kh-eco', '2026-09-22'),
    (err) => err.code === 'FOREIGN_FACT_FORBIDDEN');
});

test('互认门槛：生效义务逐成员评估并生成双边资格', async () => {
  const sec = await session('secretariat');
  const gate = sec.evaluateGate('gate-eco');
  assert.equal(gate.in_force, true);
  const byId = Object.fromEntries(gate.members.map((m) => [m.member_id, m]));
  assert.equal(byId.SG.qualified, true);
  assert.equal(byId.TH.qualified, true);
  assert.equal(byId.ID.qualified, false);
  assert.ok(byId.ID.blocker_codes.includes('technical-conformance'));
  assert.ok(byId.ID.blocker_codes.includes('evidence-accepted'));
  assert.equal(byId.KH.exemption_active, true);
  assert.equal(byId.KH.qualified, false);

  const pair = (a, b) => gate.bilateral_pairs.find(
    (p) => (p.member_a === a && p.member_b === b) || (p.member_a === b && p.member_b === a),
  );
  assert.equal(pair('SG', 'TH').eligible, true);
  assert.equal(pair('SG', 'ID').eligible, false);
  assert.equal(gate.regionwide_ready, false);
});

test('互认门槛：未生效义务不激活，任何成员不达标', async () => {
  const sec = await session('secretariat');
  const gate = sec.evaluateGate('gate-esig');
  assert.equal(gate.in_force, false);
  assert.ok(gate.members.every((m) => !m.qualified));
  assert.ok(gate.bilateral_pairs.every((p) => !p.eligible));
  assert.ok(gate.bilateral_pairs[0].reasons.some((r) => r.includes('尚未生效')));
  assert.equal(gate.regionwide_ready, false);
});

test('同行问询按当事方可见，答复受限', async () => {
  const id = await session('member', 'ID');
  const th = await session('member', 'TH');
  const kh = await session('member', 'KH');
  const sec = await session('secretariat');
  const ent = await session('enterprise');

  assert.deepEqual(id.listInquiries().map((q) => q.id), ['iq-01']);
  assert.deepEqual(th.listInquiries().map((q) => q.id), ['iq-02']);
  assert.deepEqual(kh.listInquiries().map((q) => q.id), ['iq-02']);
  assert.equal(sec.listInquiries().length, 2);
  assert.equal(ent.listInquiries().length, 0);

  // 非被问方不能答复
  assert.throws(() => id.answerInquiry({ inquiryId: 'iq-02', answer: '无权', answeredAt: '2026-09-21' }),
    (err) => err.code === 'NOT_INQUIRY_RESPONDENT');
  // 已答复的问询不能重复答复
  const sg = await session('member', 'SG');
  assert.throws(
    () => sg.answerInquiry({ inquiryId: 'iq-01', answer: '重复答复', answeredAt: '2026-09-21' }),
    (err) => err.code === 'INQUIRY_ALREADY_ANSWERED',
  );
  // 被问方答复成功
  const answer = th.answerInquiry({
    inquiryId: 'iq-02',
    answer: '建议先取得财政预算意向函再排入内阁立法议程。',
    answeredAt: '2026-09-20',
  });
  assert.equal(answer.status, 'answered');

  // 只能就本国任务发起问询
  assert.throws(() => id.openInquiry({
    to_member: 'TH',
    topic_task_id: 't-th-eco',
    subject: 'x',
    question: 'y',
    opened_at: '2026-09-21',
  }), (err) => err.code === 'FOREIGN_TOPIC_FORBIDDEN');
});

test('企业只看见已具备法律和技术条件且证据通过的状态', async () => {
  const ent = await session('enterprise');
  const catalog = ent.publicMeasureCatalog();
  const eco = catalog.find((m) => m.measure_id === 'fm-eco');
  assert.equal(eco.overall_status, 'available_in_qualified_members');
  assert.deepEqual(eco.available_in, ['SG', 'TH']);
  const byId = Object.fromEntries(eco.member_status.map((m) => [m.member_id, m]));
  assert.equal(byId.SG.status, 'available');
  assert.equal(byId.ID.status, 'unavailable');
  assert.equal(byId.KH.status, 'transition_period');
  assert.equal(byId.VN.status, 'unavailable');
  // 公开投影不得泄露退回原因等内部细节
  const serialized = JSON.stringify(eco);
  assert.doesNotMatch(serialized, /签发机关/);
  assert.doesNotMatch(serialized, /blocker/);

  const esig = catalog.find((m) => m.measure_id === 'fm-esig');
  assert.equal(esig.overall_status, 'not_yet_in_force');
  assert.ok(esig.member_status.every((m) => m.status === 'not_yet_in_force'));

  const single = ent.publicMeasureView('fm-eco', 'SG');
  assert.equal(single.status, 'available');
  assert.equal(single.name, '跨境电子原产地证书（eCO）受理');
});

test('多国敏感材料分区保存与访问控制', async () => {
  const id = await session('member', 'ID');
  const vn = await session('member', 'VN');
  const reviewer = await session('reviewer');
  const ent = await session('enterprise');

  const idDocs = id.listDocuments().map((d) => d.id);
  assert.ok(idDocs.includes('doc-id-draft-platform'));
  assert.ok(idDocs.includes('doc-asean-gate-map'));
  assert.ok(idDocs.includes('doc-public-guide'));
  assert.ok(!idDocs.includes('doc-vn-budget-ruling'));
  assert.ok(!idDocs.includes('doc-kh-evidence-return'));

  assert.throws(() => id.getDocument('doc-vn-budget-ruling'),
    (err) => err.code === 'ZONE_ACCESS_DENIED');

  // 审查人员可调取退回证据包，但看不到预算明细与立法草案
  const reviewDocs = reviewer.listDocuments().map((d) => d.id);
  assert.ok(reviewDocs.includes('doc-kh-evidence-return'));
  assert.ok(!reviewDocs.includes('doc-vn-budget-ruling'));
  assert.ok(!reviewDocs.includes('doc-id-draft-platform'));

  // 企业只能看到公开分区
  assert.deepEqual(ent.listDocuments().map((d) => d.id), ['doc-public-guide']);

  // 成员只能向本国分区登记
  assert.throws(() => vn.registerDocument({
    id: 'doc-x', kind: 'budget_detail', zone: 'restricted:TH', title: 'x',
  }), (err) => err.code === 'ZONE_ACCESS_DENIED');
  vn.registerDocument({
    id: 'doc-vn-new', kind: 'budget_detail', zone: 'restricted:VN', title: '新增本国材料',
  });
  assert.ok(vn.listDocuments().some((d) => d.id === 'doc-vn-new'));
  assert.ok(!id.listDocuments().some((d) => d.id === 'doc-vn-new'));
});

test('成员视角下他国任务降级为聚合状态', async () => {
  const th = await session('member', 'TH');
  const eco = th.matrix().find((o) => o.obligation_id === 'ob-asw-eco');
  const foreign = eco.tasks.find((t) => t.member_id === 'SG');
  assert.equal(foreign.effective_state, 'implemented');
  assert.equal(foreign.checks, undefined);
  assert.equal(foreign.budget, undefined);
  const own = eco.tasks.find((t) => t.member_id === 'TH');
  assert.ok(Array.isArray(own.checks));
});

test('跨国依赖与互认缺口仅秘书处维护', async () => {
  const sec = await session('secretariat');
  const gaps = sec.gateDependencyGaps();
  const ecoGap = gaps.find((g) => g.gate_id === 'gate-eco');
  assert.deepEqual(ecoGap.member_gaps.map((g) => g.member_id).sort(), ['ID', 'KH']);
  assert.ok(ecoGap.blocked_pairs.some((p) => !p.eligible));

  const th = await session('member', 'TH');
  assert.throws(() => th.gateDependencyGaps(), (err) => err.code === 'ROLE_FORBIDDEN');
  assert.throws(() => th.crossBorderDependencies(), (err) => err.code === 'ROLE_FORBIDDEN');
});
