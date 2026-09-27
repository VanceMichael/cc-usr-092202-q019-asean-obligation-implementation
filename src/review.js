// 完成证据的提交与审查。
//
// 审查结论 accepted/returned 追加在证据的 reviews 末尾（不可变历史）：
// 退回必须记录原因，成员只能以新材料重新提交，不能覆盖旧结论。

import { DomainError } from './util.js';

export function submitEvidence(evidenceDoc, entry) {
  const { id, measure_code, type, title, doc_ref, submitted_at } = entry;
  if (evidenceDoc.evidence.some((e) => e.id === id)) {
    throw new DomainError('EVIDENCE_EXISTS', `证据编号已存在: ${id}`);
  }
  for (const field of ['measure_code', 'type', 'title', 'doc_ref', 'submitted_at']) {
    if (!entry[field]) throw new DomainError('EVIDENCE_INCOMPLETE', `证据缺少字段: ${field}`);
  }
  evidenceDoc.evidence.push({
    id, measure_code, type, title, doc_ref, submitted_at, reviews: [],
  });
  return evidenceDoc;
}

// 审查人员给出结论；退回必须写原因，且原因随证据永久保留。
export function reviewEvidence(evidenceDoc, evidenceId, { by, at, decision, reason }) {
  const ev = evidenceDoc.evidence.find((item) => item.id === evidenceId);
  if (!ev) throw new DomainError('EVIDENCE_UNKNOWN', `证据不存在: ${evidenceId}`);
  if (!['accepted', 'returned'].includes(decision)) {
    throw new DomainError('INVALID_REVIEW_DECISION', `审查结论无效: ${decision}`);
  }
  if (decision === 'returned' && (!reason || reason.trim().length < 10)) {
    throw new DomainError('RETURN_REASON_REQUIRED', '证据退回必须记录不少于10字的原因');
  }
  ev.reviews.push({ by, at, decision, reason: decision === 'returned' ? reason : null });
  return ev;
}

export function isAccepted(ev) {
  const last = ev.reviews[ev.reviews.length - 1];
  return Boolean(last && last.decision === 'accepted');
}

// 列出当前处于退回状态的证据（用于秘书处催办与公开视图排除）。
export function returnedEvidence(evidenceDoc) {
  return evidenceDoc.evidence
    .filter((ev) => ev.reviews.length > 0 && ev.reviews[ev.reviews.length - 1].decision === 'returned');
}
