// 义务实施矩阵：把正式条款拆成责任机关、法律修订、技术接口、预算、完成证据与适用豁免。
// 秘书处负责装配与跨国依赖；成员只确认本国事实（confirmOwnFact 仅允许写入本成员任务）。

import {
  MatrixError,
  authorityOf,
  effectiveTaskState,
  exemptionActive,
  memberName,
  obligationOf,
  readinessChecks,
} from './model.js';

export function buildObligationMatrix(caseData, { memberId = null } = {}) {
  return caseData.obligations.map((obligation) => {
    const agreement = caseData.agreements.find((a) => a.id === obligation.agreement_id);
    const rows = caseData.tasks
      .filter((t) => t.obligation_id === obligation.id)
      .map((task) => {
        const authority = authorityOf(caseData, task);
        const derived = effectiveTaskState(caseData, task);
        const row = {
          task_id: task.id,
          member_id: task.member_id,
          member_name: memberName(caseData, task.member_id),
          obligation_id: obligation.id,
          obligation_in_force: obligation.entry_into_force === 'in_force',
          authority: authority ? { id: authority.id, name: authority.name, domain: authority.domain } : null,
          title: task.title,
          legal_revision: task.legal_revision,
          technical_interface: task.technical_interface,
          budget: task.budget,
          deadline: task.deadline,
          evidence_required: task.evidence_required,
          exemption: exemptionActive(task, caseData._as_of),
          claimed_status: task.claimed_status,
          effective_state: derived.state,
          fact_confirmed: task.fact_confirmed ?? null,
          checks: readinessChecks(caseData, task),
        };
        // 成员视角下，其他成员的明细降级为聚合状态，避免跨国敏感事实扩散。
        if (memberId && task.member_id !== memberId) {
          return {
            task_id: row.task_id,
            member_id: row.member_id,
            member_name: row.member_name,
            obligation_id: row.obligation_id,
            obligation_in_force: row.obligation_in_force,
            effective_state: row.effective_state,
            exemption_active: row.exemption != null,
            fact_confirmed: row.fact_confirmed != null,
          };
        }
        return row;
      });
    return {
      obligation_id: obligation.id,
      agreement: { id: agreement.id, name: agreement.name, status: agreement.status },
      article: obligation.article,
      title: obligation.title,
      entry_into_force: obligation.entry_into_force,
      tasks: rows,
    };
  });
}

// 成员国确认本国事实：只能确认属于本成员的任务。
export function confirmOwnFact(caseData, memberId, taskId, at) {
  const task = caseData.tasks.find((t) => t.id === taskId);
  if (!task) { throw new MatrixError('TASK_NOT_FOUND', `任务 ${taskId} 不存在`); }
  if (task.member_id !== memberId) {
    throw new MatrixError('FOREIGN_FACT_FORBIDDEN', '成员国只能确认本国事实，跨国依赖由秘书处处理');
  }
  if (task.fact_confirmed?.by_member === memberId) {
    throw new MatrixError('FACT_ALREADY_CONFIRMED', '本国事实已经确认，无需重复确认');
  }
  task.fact_confirmed = { by_member: memberId, at };
  return task;
}

// 秘书处汇总跨国依赖：哪些义务的实施卡在哪些成员、哪些条件。
export function crossBorderDependencies(caseData) {
  return caseData.recognition_gates.map((gate) => {
    const obligation = obligationOf(caseData, gate.obligation_id);
    const memberStates = caseData.tasks
      .filter((t) => t.obligation_id === gate.obligation_id)
      .map((task) => {
        const derived = effectiveTaskState(caseData, task);
        return {
          member_id: task.member_id,
          member_name: memberName(caseData, task.member_id),
          effective_state: derived.state,
          blockers: derived.state === 'implemented' ? [] : readinessChecks(caseData, task)
            .filter((c) => !c.met)
            .map((c) => ({ code: c.code, label: c.label })),
          exemption_active: derived.exemption != null,
        };
      });
    return {
      gate_id: gate.id,
      obligation_id: gate.obligation_id,
      obligation_in_force: obligation.entry_into_force === 'in_force',
      bilateral: gate.bilateral === true,
      members: memberStates,
    };
  });
}
