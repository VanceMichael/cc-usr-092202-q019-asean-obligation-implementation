// 领域模型：义务实施状态推导、阻断规则、豁免有效性与资料装载校验。
// 所有函数均为纯函数风格；写入类操作集中在 reporting.js。

export class MatrixError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MatrixError';
    this.code = code;
  }
}

// 成员国可申报的实施状态。
export const CLAIMED_STATUS = [
  'not_started',
  'planned',
  'in_progress',
  'partially_complete',
  'implemented',
];

// 季度回报中需要强制保留原因的变更类型。
export const CHANGE_KINDS = [
  'plan_adjusted',
  'deadline_extended',
  'partially_complete',
  'evidence_returned',
];

export const today = (asOf) => asOf;

// 结构与引用完整性校验：秘书处据此保证跨国矩阵可装配。
export function loadCase(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (value.domain !== 'asean-obligation-implementation') {
    throw new MatrixError('BAD_DOMAIN', '领域标识不正确');
  }
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new MatrixError('BAD_VERSION', '缺少有效的资料版本');
  }
  for (const key of ['agreements', 'members', 'obligations', 'tasks', 'recognition_gates', 'facility_measures']) {
    if (!Array.isArray(value[key])) {
      throw new MatrixError('BAD_SHAPE', `缺少数组字段 ${key}`);
    }
  }
  value.quarterly_reports ??= [];
  value.evidence_submissions ??= [];
  value.inquiries ??= [];
  value.documents ??= [];
  value.rejected_intake ??= [];

  const agreements = new Map(value.agreements.map((a) => [a.id, a]));
  const members = new Map(value.members.map((m) => [m.id, m]));
  const obligations = new Map();
  for (const o of value.obligations) {
    if (!agreements.has(o.agreement_id)) {
      throw new MatrixError('BAD_REFERENCE', `义务 ${o.id} 引用了不存在的协定`);
    }
    obligations.set(o.id, o);
  }
  const tasks = new Map();
  for (const t of value.tasks) {
    if (!obligations.has(t.obligation_id)) {
      throw new MatrixError('BAD_REFERENCE', `任务 ${t.id} 引用了不存在的义务`);
    }
    if (!members.has(t.member_id)) {
      throw new MatrixError('BAD_REFERENCE', `任务 ${t.id} 引用了不存在的成员`);
    }
    tasks.set(t.id, t);
  }
  for (const e of value.evidence_submissions) {
    if (!tasks.has(e.task_id)) {
      throw new MatrixError('BAD_REFERENCE', `证据 ${e.id} 引用了不存在的任务`);
    }
  }
  for (const r of value.quarterly_reports) {
    if (!tasks.has(r.task_id)) {
      throw new MatrixError('BAD_REFERENCE', `季度回报 ${r.id} 引用了不存在的任务`);
    }
  }
  for (const g of value.recognition_gates) {
    if (!obligations.has(g.obligation_id)) {
      throw new MatrixError('BAD_REFERENCE', `互认门槛 ${g.id} 引用了不存在的义务`);
    }
  }
  for (const m of value.facility_measures) {
    if (!value.recognition_gates.some((g) => g.id === m.gate_id)) {
      throw new MatrixError('BAD_REFERENCE', `便利化措施 ${m.id} 引用了不存在的互认门槛`);
    }
  }
  for (const q of value.inquiries) {
    for (const m of q.party_members ?? []) {
      if (!members.has(m)) {
        throw new MatrixError('BAD_REFERENCE', `问询 ${q.id} 引用了不存在的成员 ${m}`);
      }
    }
  }
  value._as_of = value.as_of ?? new Date().toISOString().slice(0, 10);
  return value;
}

export function obligationOf(caseData, obligationId) {
  return caseData.obligations.find((o) => o.id === obligationId);
}

export function taskFor(caseData, obligationId, memberId) {
  return caseData.tasks.find((t) => t.obligation_id === obligationId && t.member_id === memberId) ?? null;
}

export function memberName(caseData, memberId) {
  return caseData.members.find((m) => m.id === memberId)?.name ?? memberId;
}

export function authorityOf(caseData, task) {
  const member = caseData.members.find((m) => m.id === task.member_id);
  return member?.authorities.find((a) => a.id === task.authority_id) ?? null;
}

// 条款是否已生效：以义务自身标记为准（与所属协定一致）。
export function obligationInForce(caseData, obligationId) {
  return obligationOf(caseData, obligationId)?.entry_into_force === 'in_force';
}

// 豁免当前是否有效（如最不发达成员过渡期）。
export function exemptionActive(task, asOf) {
  const e = task?.exemption;
  if (!e || !e.notified) { return null; }
  const refDate = asOf;
  if (e.valid_from && refDate < e.valid_from) { return null; }
  if (e.valid_to && refDate > e.valid_to) { return null; }
  return e;
}

function acceptedEvidenceTypes(caseData, taskId) {
  return new Set(
    caseData.evidence_submissions
      .filter((e) => e.task_id === taskId && e.review?.decision === 'accepted')
      .map((e) => e.evidence_type),
  );
}

function evidenceStatus(caseData, task) {
  const accepted = acceptedEvidenceTypes(caseData, task.id);
  return task.evidence_required.map((type) => {
    const submissions = caseData.evidence_submissions.filter((e) => e.task_id === task.id && e.evidence_type === type);
    let state = 'missing';
    let detail = '尚未提交';
    const returned = submissions.find((s) => s.review?.decision === 'returned');
    const acceptedNow = submissions.find((s) => s.review?.decision === 'accepted');
    const pending = submissions.find((s) => !s.review);
    if (acceptedNow) {
      state = 'accepted';
      detail = '已通过审查';
    } else if (returned) {
      state = 'returned';
      detail = `已退回：${returned.review.reason}`;
    } else if (pending) {
      state = 'pending';
      detail = '审查中';
    }
    return { evidence_type: type, state, detail };
  });
}

function legalReady(task) {
  const l = task.legal_revision ?? {};
  return !l.required || l.enactment_state === 'enacted';
}

function technicalReady(task) {
  const t = task.technical_interface ?? {};
  return !t.required || t.conformance === 'passed';
}

function budgetReady(task) {
  return task.budget?.status === 'approved';
}

function factConfirmed(task, memberId) {
  return task.fact_confirmed?.by_member != null && task.fact_confirmed.by_member === memberId;
}

// 逐项检查任务在成员境内的法律、技术、预算、证据与事实确认条件。
export function readinessChecks(caseData, task) {
  const checks = [
    {
      code: 'legal',
      label: '法律修订已生效',
      met: legalReady(task),
      detail: legalReady(task)
        ? (task.legal_revision.required ? `已颁布：${task.legal_revision.instrument}` : '无需修订，现行法已覆盖')
        : `未完成：${task.legal_revision.instrument ?? '待确定立法'}（${task.legal_revision.enactment_state ?? 'none'}）`,
    },
    {
      code: 'technical',
      label: '技术接口一致性通过',
      met: technicalReady(task),
      detail: technicalReady(task)
        ? `已通过：${task.technical_interface.spec}`
        : `未通过：${task.technical_interface.spec}（${task.technical_interface.conformance}）`,
    },
    {
      code: 'budget',
      label: '预算已批复',
      met: budgetReady(task),
      detail: `预算状态：${task.budget?.status ?? 'none'}`,
    },
    {
      code: 'fact_confirmed',
      label: '成员国已确认本国事实',
      met: factConfirmed(task, task.member_id),
      detail: factConfirmed(task, task.member_id)
        ? `由 ${task.member_id} 于 ${task.fact_confirmed.at} 确认`
        : '成员尚未确认本国事实',
    },
  ];
  const evidence = evidenceStatus(caseData, task);
  for (const item of evidence) {
    checks.push({
      code: `evidence:${item.evidence_type}`,
      label: `证据通过审查：${item.evidence_type}`,
      met: item.state === 'accepted',
      detail: item.detail,
    });
  }
  return checks;
}

// 申报"已落实"时的阻断项；条款未生效为最高优先级阻断。
export function implementationBlockers(caseData, task) {
  const blockers = [];
  if (!obligationInForce(caseData, task.obligation_id)) {
    blockers.push({ code: 'ARTICLE_NOT_IN_FORCE', label: '条款尚未生效，不得标记为已落实' });
  }
  const checks = readinessChecks(caseData, task);
  for (const c of checks) {
    if (c.met) { continue; }
    if (c.code === 'legal') { blockers.push({ code: 'LEGAL_NOT_ENACTED', label: c.label, detail: c.detail }); }
    else if (c.code === 'technical') { blockers.push({ code: 'TECHNICAL_NOT_CONFORMANT', label: c.label, detail: c.detail }); }
    else if (c.code === 'budget') { blockers.push({ code: 'BUDGET_NOT_APPROVED', label: c.label, detail: c.detail }); }
    else if (c.code === 'fact_confirmed') { blockers.push({ code: 'FACT_NOT_CONFIRMED', label: c.label, detail: c.detail }); }
    else if (c.code.startsWith('evidence:')) {
      blockers.push({ code: 'EVIDENCE_INCOMPLETE', label: c.label, detail: c.detail, evidence_type: c.code.slice('evidence:'.length) });
    }
  }
  return blockers;
}

// 派生实施状态：成员的自我申报必须经过阻断规则校正。
// - 申报 implemented 且无阻断 → implemented
// - 境内条件全部满足、仅条款未生效 → domestically_ready（已备妥但不得称已落实）
// - 其余申报状态原样保留，但附带未解除阻断。
export function effectiveTaskState(caseData, task) {
  const exemption = exemptionActive(task, caseData._as_of);
  const blockers = task.claimed_status === 'implemented'
    ? implementationBlockers(caseData, task)
    : [];
  if (task.claimed_status === 'implemented' && blockers.length === 0) {
    return { state: 'implemented', blockers: [], exemption: null };
  }
  if (task.claimed_status === 'implemented') {
    const domestic = readinessChecks(caseData, task).every((c) => c.met);
    const onlyNotInForce = domestic && blockers.every((b) => b.code === 'ARTICLE_NOT_IN_FORCE');
    return {
      state: onlyNotInForce ? 'domestically_ready' : 'in_progress',
      blockers,
      exemption,
    };
  }
  return { state: task.claimed_status, blockers: [], exemption };
}

export { evidenceStatus, legalReady, technicalReady, acceptedEvidenceTypes };
