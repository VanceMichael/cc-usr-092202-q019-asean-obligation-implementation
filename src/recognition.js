// 互认门槛检查：秘书处依据法律等效、技术一致性、证据审查三类标准逐成员评估。
// 双边门槛逐对成员判定；条款未生效时门槛不激活，任何成员不得被认定为已达标。

import {
  evidenceStatus,
  exemptionActive,
  legalReady,
  memberName,
  obligationInForce,
  technicalReady,
} from './model.js';

function criterionResults(caseData, task, criteria) {
  const result = {};
  for (const c of criteria) {
    if (!task) {
      result[c.id] = { criterion_id: c.id, kind: c.kind, state: 'absent', detail: '该成员无对应实施任务' };
      continue;
    }
    if (c.kind === 'legal') {
      const met = legalReady(task);
      result[c.id] = {
        criterion_id: c.id,
        kind: c.kind,
        state: met ? 'met' : 'unmet',
        detail: met ? '国内法条件具备' : `立法未完成（${task.legal_revision.enactment_state ?? 'none'}）`,
      };
    } else if (c.kind === 'technical') {
      const met = technicalReady(task);
      result[c.id] = {
        criterion_id: c.id,
        kind: c.kind,
        state: met ? 'met' : 'unmet',
        detail: met ? '一致性测试通过' : `接口状态：${task.technical_interface.conformance}`,
      };
    } else {
      const items = evidenceStatus(caseData, task);
      const allAccepted = items.length > 0 && items.every((i) => i.state === 'accepted');
      const returned = items.filter((i) => i.state === 'returned');
      result[c.id] = {
        criterion_id: c.id,
        kind: c.kind,
        state: allAccepted ? 'met' : 'unmet',
        detail: allAccepted
          ? '全部必备证据通过审查'
          : returned.length > 0
            ? `存在退回证据：${returned.map((i) => i.detail).join('；')}`
            : '必备证据未全部通过审查',
      };
    }
  }
  return result;
}

export function evaluateGate(caseData, gate) {
  const inForce = obligationInForce(caseData, gate.obligation_id);
  const memberResults = caseData.members.map((member) => {
    const task = caseData.tasks.find((t) => t.obligation_id === gate.obligation_id && t.member_id === member.id) ?? null;
    const criteria = criterionResults(caseData, task, gate.criteria);
    const domesticMet = Object.values(criteria).every((c) => c.state === 'met');
    const exemption = task ? exemptionActive(task, caseData._as_of) : null;
    const blockers = [];
    if (!inForce) { blockers.push('ARTICLE_NOT_IN_FORCE'); }
    for (const c of Object.values(criteria)) {
      if (c.state !== 'met') { blockers.push(c.criterion_id); }
    }
    return {
      member_id: member.id,
      member_name: memberName(caseData, member.id),
      has_task: task != null,
      criteria,
      domestic_met: domesticMet,
      exemption_active: exemption != null,
      exemption: exemption
        ? { clause: exemption.clause, scope: exemption.scope, valid_to: exemption.valid_to }
        : null,
      // 已达标 = 条款生效 且 法律/技术/证据标准全部满足；豁免成员标记为过渡期而非达标。
      qualified: inForce && domesticMet,
      blocker_codes: blockers,
    };
  });

  const bilateralPairs = [];
  if (gate.bilateral === true) {
    const participants = memberResults.filter((m) => m.has_task);
    for (let i = 0; i < participants.length; i += 1) {
      for (let j = i + 1; j < participants.length; j += 1) {
        const a = participants[i];
        const b = participants[j];
        const reasons = [];
        if (!inForce) { reasons.push('条款尚未生效，互认不启动'); }
        if (!a.qualified) { reasons.push(`${a.member_name}未达标（${a.blocker_codes.join('、')}）`); }
        if (!b.qualified) { reasons.push(`${b.member_name}未达标（${b.blocker_codes.join('、')}）`); }
        bilateralPairs.push({
          member_a: a.member_id,
          member_b: b.member_id,
          eligible: reasons.length === 0,
          reasons,
        });
      }
    }
  }

  const active = memberResults.filter((m) => m.has_task);
  const exempt = active.filter((m) => m.exemption_active);
  const required = active.filter((m) => !m.exemption_active);
  return {
    gate_id: gate.id,
    name: gate.name,
    obligation_id: gate.obligation_id,
    in_force: inForce,
    bilateral: gate.bilateral === true,
    criteria: gate.criteria.map((c) => ({ id: c.id, kind: c.kind, label: c.label })),
    members: memberResults,
    bilateral_pairs: bilateralPairs,
    regionwide_ready: inForce
      && required.length > 0
      && required.every((m) => m.qualified),
    exempt_members: exempt.map((m) => ({
      member_id: m.member_id,
      valid_to: m.exemption.valid_to,
      scope: m.exemption.scope,
    })),
  };
}

export function evaluateAllGates(caseData) {
  return caseData.recognition_gates.map((gate) => evaluateGate(caseData, gate));
}

// 秘书处视角的跨国依赖清单：未达标成员、具体阻断条件与双边缺口。
export function gateDependencyGaps(caseData) {
  return evaluateAllGates(caseData).map((result) => ({
    gate_id: result.gate_id,
    name: result.name,
    in_force: result.in_force,
    regionwide_ready: result.regionwide_ready,
    member_gaps: result.members
      .filter((m) => m.has_task && !m.qualified)
      .map((m) => ({
        member_id: m.member_id,
        member_name: m.member_name,
        exemption_active: m.exemption_active,
        blocker_codes: m.blocker_codes,
      })),
    blocked_pairs: result.bilateral
      ? result.bilateral_pairs.filter((p) => !p.eligible)
      : [],
  }));
}
