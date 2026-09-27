// 同行问询：成员间就某项措施提出事实性问询。
//
// 规则：
//   - 只有被问询成员（to）可以作答；提问方不能自问自答，秘书处不作答只登记说明
//   - 跨国依赖/互认条件类问题由秘书处登记为依赖项（线索保留在问询串中）
//   - 超过 due_at 未作答可升级至秘书处，升级动作与原因留痕
//   - thread 只追加、不改写；每个成员分区各存一份镜像，答案写入被问询方分区

import { DomainError } from './util.js';

let seq = 0;
export function createInquiryId(from, to, date) {
  seq += 1;
  return `Q-${from}-${to}-${date.replaceAll('-', '')}-${seq}`;
}

// 发起问询（写入提问方分区的发出镜像）。
export function raiseInquiry(inquiriesDoc, { from, to, measure_code, raised_at, subject, body, due_at }) {
  if (inquiriesDoc.member !== from) {
    throw new DomainError('ZONE_MISMATCH', '只能以本区成员国身份发起问询');
  }
  if (from === to) throw new DomainError('SELF_INQUIRY', '不能向本国发起问询');
  if (!subject || !body) throw new DomainError('INQUIRY_INCOMPLETE', '问询必须包含主题与正文');
  const inquiry = {
    id: createInquiryId(from, to, raised_at),
    from, to, measure_code,
    raised_at, subject, body,
    due_at: due_at ?? null,
    thread: [],
    status: due_at ? 'open' : 'open',
  };
  inquiriesDoc.inquiries.push(inquiry);
  return inquiry;
}

function findInquiry(doc, id) {
  const inquiry = doc.inquiries.find((item) => item.id === id);
  if (!inquiry) throw new DomainError('INQUIRY_UNKNOWN', `问询不存在: ${id}`);
  return inquiry;
}

// 被问询成员作答；仅 to 身份可调用，答案追加到其本区收件镜像。
export function answerInquiry(inquiriesDoc, inquiryId, { by, at, text }) {
  const inquiry = findInquiry(inquiriesDoc, inquiryId);
  if (inquiriesDoc.member !== inquiry.to || by !== inquiry.to) {
    throw new DomainError('NOT_RESPONDENT', '只有被问询成员可以作答');
  }
  if (inquiry.status === 'closed') {
    throw new DomainError('INQUIRY_CLOSED', '已关闭问询不能继续作答');
  }
  if (!text || text.trim().length < 10) {
    throw new DomainError('ANSWER_TOO_SHORT', '答复内容不少于10字');
  }
  inquiry.thread.push({ at, by, kind: 'answer', text });
  inquiry.status = 'answered';
  return inquiry;
}

// 秘书处登记说明（如把问题转为跨国依赖项）；不替代成员作答。
export function addSecretariatNote(inquiriesDoc, inquiryId, { at, text, dependency_id }) {
  const inquiry = findInquiry(inquiriesDoc, inquiryId);
  inquiry.thread.push({
    at, by: 'ASEAN Secretariat', kind: 'note', text,
    dependency_id: dependency_id ?? null,
  });
  return inquiry;
}

// 超时未作答 → 升级至秘书处；升级原因留痕，问询状态转为 escalated。
export function escalateInquiry(inquiriesDoc, inquiryId, { at, reason }) {
  const inquiry = findInquiry(inquiriesDoc, inquiryId);
  if (inquiry.status === 'answered' || inquiry.status === 'closed') {
    throw new DomainError('INQUIRY_ALREADY_DONE', '已作答/已关闭问询无需升级');
  }
  if (!inquiry.due_at || at <= inquiry.due_at) {
    throw new DomainError('NOT_OVERDUE', '问询尚未超过答复期限，不能升级');
  }
  if (!reason || reason.trim().length < 10) {
    throw new DomainError('ESCALATION_REASON_REQUIRED', '升级必须记录不少于10字的原因');
  }
  inquiry.thread.push({ at, by: 'ASEAN Secretariat', kind: 'escalation', reason });
  inquiry.status = 'escalated';
  return inquiry;
}

// 秘书处汇总视角：按状态列出全部成员分区的问询镜像并去重（按 id）。
export function listAllInquiries(workspace) {
  const byId = new Map();
  for (const docs of Object.values(workspace.members)) {
    for (const inquiry of docs.inquiries?.inquiries ?? []) {
      const existing = byId.get(inquiry.id);
      // 保留 thread 更长的一份镜像（答案通常在被问询方分区）
      if (!existing || inquiry.thread.length > existing.thread.length) {
        byId.set(inquiry.id, inquiry);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.raised_at.localeCompare(b.raised_at));
}
