// 企业公开摘要：企业查看便利化措施时，只显示已经具备法律与技术条件且证据通过审查的状态。
// 未生效条款、退回证据、豁免过渡期、未确认事实一律不呈现为"可用"；敏感明细不进入公开投影。

import { evaluateGate } from './recognition.js';

// 单成员在某门槛下的对外公开状态。
function publicMemberStatus(gateResult, memberId) {
  const m = gateResult.members.find((x) => x.member_id === memberId);
  if (!gateResult.in_force) {
    return { member_id: memberId, status: 'not_yet_in_force', note: '相关条款尚未生效' };
  }
  if (!m?.has_task) {
    return { member_id: memberId, status: 'unavailable', note: '暂无实施安排' };
  }
  if (m.exemption_active) {
    return { member_id: memberId, status: 'transition_period', note: '该成员适用过渡期安排' };
  }
  if (m.qualified) {
    return { member_id: memberId, status: 'available', note: '法律与技术条件具备，证据通过审查' };
  }
  // 未达标不暴露内部阻断细节，仅提示暂不可用。
  return { member_id: memberId, status: 'unavailable', note: '法律或技术条件尚未全部具备' };
}

export function publicMeasureCatalog(caseData) {
  return caseData.facility_measures.map((measure) => {
    const gate = caseData.recognition_gates.find((g) => g.id === measure.gate_id);
    const gateResult = evaluateGate(caseData, gate);
    const members = caseData.members.map((member) => publicMemberStatus(gateResult, member.id));
    const availableMembers = members.filter((m) => m.status === 'available');
    return {
      measure_id: measure.id,
      name: measure.name,
      description: measure.description,
      in_force: gateResult.in_force,
      // 企业看到的措施状态只有三档：可用 / 尚未生效 / 暂不可用。
      overall_status: !gateResult.in_force
        ? 'not_yet_in_force'
        : availableMembers.length === 0
          ? 'unavailable'
          : 'available_in_qualified_members',
      available_in: availableMembers.map((m) => m.member_id),
      member_status: members,
      as_of: caseData._as_of,
    };
  });
}

// 企业查看某一项措施的单成员状态：只返回公开字段。
export function publicMeasureView(caseData, measureId, memberId) {
  const measure = caseData.facility_measures.find((m) => m.id === measureId);
  if (!measure) { return null; }
  const gate = caseData.recognition_gates.find((g) => g.id === measure.gate_id);
  const gateResult = evaluateGate(caseData, gate);
  return {
    measure_id: measure.id,
    name: measure.name,
    description: measure.description,
    as_of: caseData._as_of,
    ...publicMemberStatus(gateResult, memberId),
  };
}
