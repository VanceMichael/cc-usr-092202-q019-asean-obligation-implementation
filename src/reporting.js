// 季度回报：成员国逐季申报实施状态；计划调整、期限延长、部分完成、证据退回必须留存原因。
// 申报"已落实"必须通过阻断检查（未生效条款一律不得标记为已落实），拒绝记录进入不可删除的留痕台账。

import {
  CHANGE_KINDS,
  CLAIMED_STATUS,
  MatrixError,
  implementationBlockers,
} from './model.js';

function validateChanges(changes) {
  for (const change of changes) {
    if (!CHANGE_KINDS.includes(change.kind)) {
      throw new MatrixError('BAD_CHANGE_KIND', `未知变更类型：${change.kind}`);
    }
    if (!change.reason || !String(change.reason).trim()) {
      throw new MatrixError('REASON_REQUIRED', `变更 ${change.kind} 必须填写原因`);
    }
    if (change.kind === 'deadline_extended' && (!change.previous_deadline || !change.new_deadline)) {
      throw new MatrixError('DEADLINE_DATES_REQUIRED', '期限延长必须注明原期限与新期限');
    }
    if (change.kind === 'evidence_returned' && !change.evidence_submission_id) {
      throw new MatrixError('EVIDENCE_REF_REQUIRED', '证据退回必须关联证据提交编号');
    }
  }
}

// 接收季度回报。成功时写入台账并更新任务申报状态；被阻断时拒绝并在 rejected_intake 留痕。
export function recordQuarterlyReport(caseData, input) {
  const task = caseData.tasks.find((t) => t.id === input.task_id);
  if (!task) { throw new MatrixError('TASK_NOT_FOUND', `任务 ${input.task_id} 不存在`); }
  if (task.member_id !== input.member_id) {
    throw new MatrixError('FOREIGN_TASK_FORBIDDEN', '成员国只能回报本国任务');
  }
  if (!CLAIMED_STATUS.includes(input.claimed_status)) {
    throw new MatrixError('BAD_STATUS', `申报状态无效：${input.claimed_status}`);
  }
  validateChanges(input.changes ?? []);

  if (input.claimed_status === 'implemented') {
    const blockers = implementationBlockers(caseData, task);
    if (blockers.length > 0) {
      const rejected = {
        id: `ri-${task.id}-${input.submitted_at}`,
        task_id: task.id,
        member_id: input.member_id,
        attempted_at: input.submitted_at,
        attempted_claim: 'implemented',
        rejected_code: blockers[0].code,
        blocker_codes: blockers.map((b) => b.code),
        reason: blockers.map((b) => b.label).join('；'),
      };
      caseData.rejected_intake.push(rejected);
      throw new MatrixError(
        'IMPLEMENTATION_BLOCKED',
        `任务 ${task.id} 不能标记为已落实：${rejected.reason}`,
      );
    }
  }

  const extension = (input.changes ?? []).find((c) => c.kind === 'deadline_extended');
  if (extension) { task.deadline = extension.new_deadline; }
  task.claimed_status = input.claimed_status;

  const report = {
    id: input.id ?? `r-${task.id}-${input.quarter}`,
    task_id: task.id,
    member_id: input.member_id,
    quarter: input.quarter,
    submitted_at: input.submitted_at,
    claimed_status: input.claimed_status,
    changes: input.changes ?? [],
  };
  if (caseData.quarterly_reports.some((r) => r.id === report.id)) {
    throw new MatrixError('DUPLICATE_REPORT', `季度回报已存在：${report.id}`);
  }
  caseData.quarterly_reports.push(report);
  return report;
}

// 台账读取：成员只能看本国回报；秘书处可看全部。
export function listQuarterlyReports(caseData, { memberId = null } = {}) {
  const reports = memberId
    ? caseData.quarterly_reports.filter((r) => r.member_id === memberId)
    : caseData.quarterly_reports;
  return reports.map((r) => ({
    ...r,
    task: caseData.tasks.find((t) => t.id === r.task_id)?.title ?? null,
  }));
}

// 单任务审计轨迹：所有带原因的变更与证据退回按时间排列，供秘书处与责任成员追溯。
export function taskAuditTrail(caseData, taskId) {
  const trail = [];
  for (const r of caseData.quarterly_reports.filter((x) => x.task_id === taskId)) {
    for (const c of r.changes) {
      trail.push({
        at: r.submitted_at,
        quarter: r.quarter,
        member_id: r.member_id,
        kind: c.kind,
        reason: c.reason,
        detail: c.kind === 'deadline_extended'
          ? { previous_deadline: c.previous_deadline, new_deadline: c.new_deadline }
          : c.kind === 'evidence_returned'
            ? { evidence_submission_id: c.evidence_submission_id }
            : null,
      });
    }
  }
  for (const e of caseData.evidence_submissions.filter((x) => x.task_id === taskId && x.review?.decision === 'returned')) {
    trail.push({
      at: e.review.at,
      kind: 'evidence_returned',
      member_id: e.member_id,
      reason: e.review.reason,
      detail: { evidence_submission_id: e.id, evidence_type: e.evidence_type },
    });
  }
  for (const ri of caseData.rejected_intake.filter((x) => x.task_id === taskId)) {
    trail.push({
      at: ri.attempted_at,
      kind: 'implementation_claim_rejected',
      member_id: ri.member_id,
      reason: ri.reason,
      detail: { rejected_code: ri.rejected_code },
    });
  }
  return trail.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
