// 同行问询：成员间就本国实施做法提问；问询仅当事成员与秘书处可见。
// 提问/答复均不修改任务事实，只形成可追溯的同行交流记录。

import { MatrixError } from './model.js';

export function openInquiry(caseData, input) {
  const task = caseData.tasks.find((t) => t.id === input.topic_task_id);
  if (!task) { throw new MatrixError('TASK_NOT_FOUND', `任务 ${input.topic_task_id} 不存在`); }
  if (task.member_id !== input.from_member) {
    throw new MatrixError('FOREIGN_TOPIC_FORBIDDEN', '只能就本国任务发起同行问询');
  }
  if (!caseData.members.some((m) => m.id === input.to_member)) {
    throw new MatrixError('MEMBER_NOT_FOUND', `被问询成员不存在：${input.to_member}`);
  }
  if (input.from_member === input.to_member) {
    throw new MatrixError('SELF_INQUIRY_FORBIDDEN', '不能向本国发起问询');
  }
  if (!input.subject?.trim() || !input.question?.trim()) {
    throw new MatrixError('INQUIRY_CONTENT_REQUIRED', '问询主题与内容不能为空');
  }
  const inquiry = {
    id: input.id ?? `iq-${String(caseData.inquiries.length + 1).padStart(2, '0')}`,
    from_member: input.from_member,
    to_member: input.to_member,
    topic_task_id: input.topic_task_id,
    subject: input.subject,
    question: input.question,
    status: 'open',
    answer: null,
    opened_at: input.opened_at,
    answered_at: null,
    party_members: [input.from_member, input.to_member],
  };
  caseData.inquiries.push(inquiry);
  return inquiry;
}

export function answerInquiry(caseData, { inquiryId, memberId, answer, answeredAt }) {
  const inquiry = caseData.inquiries.find((q) => q.id === inquiryId);
  if (!inquiry) { throw new MatrixError('INQUIRY_NOT_FOUND', `问询 ${inquiryId} 不存在`); }
  if (inquiry.to_member !== memberId) {
    throw new MatrixError('NOT_INQUIRY_RESPONDENT', '只有被问询成员可以答复');
  }
  if (inquiry.status === 'answered') {
    throw new MatrixError('INQUIRY_ALREADY_ANSWERED', '问询已答复');
  }
  if (!answer?.trim()) { throw new MatrixError('ANSWER_REQUIRED', '答复内容不能为空'); }
  inquiry.answer = answer;
  inquiry.status = 'answered';
  inquiry.answered_at = answeredAt;
  return inquiry;
}

// 可见性：秘书处可见全部；成员仅可见自己作为发问方或被问方的记录；其他角色不可见。
export function listInquiries(caseData, viewer) {
  if (viewer.role === 'secretariat') { return caseData.inquiries; }
  if (viewer.role === 'member') {
    return caseData.inquiries.filter((q) => q.party_members.includes(viewer.memberId));
  }
  return [];
}
