// 义务实施矩阵核心：把正式条款拆成六要素国内事项，并评估各道实施门槛。
//
// 门槛（门）说明：
//   article       条款本身已生效（未生效条款永远不构成已落实）
//   legal         国内法律修订已实际生效（enacted_not_in_force 仅算"国内就绪"）
//   technical     技术接口已上线运行（pilot/uat/build 均不算）
//   budget        预算已拨付（requested/partial 不算）
//   evidence      完成证据存在且最新审查结论为 accepted（待审/退回均不算）
//   exemption     不存在阻断性豁免
//   prerequisites 前置措施已达到同等水平

import { DomainError } from './util.js';
import { indexCatalog } from './catalog.js';

export { DomainError };
export { indexCatalog };

export const TASK_STATES = ['implemented', 'partial', 'in_progress', 'planned', 'ready_pending_entry'];
export const CONFIRMATION_STATES = ['draft', 'confirmed'];

export function latestReview(evidence) {
  return evidence.reviews.length > 0 ? evidence.reviews[evidence.reviews.length - 1] : null;
}

// 证据门：以最新提交的一份证据的最新审查结论为准。
// 新材料被接受即视为通过（旧退回材料永久保留在证据史中，但不再阻断）；
// 最新材料待审或被退回，则不通过。
export function evaluateEvidence(evidenceDoc, evidenceIds) {
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
    return { pass: false, code: 'EVIDENCE_MISSING' };
  }
  const referenced = [];
  for (const id of evidenceIds) {
    const ev = evidenceDoc.evidence.find((item) => item.id === id);
    if (!ev) return { pass: false, code: 'EVIDENCE_UNKNOWN', evidence_id: id };
    referenced.push(ev);
  }
  referenced.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
  const newest = referenced[referenced.length - 1];
  const review = latestReview(newest);
  if (!review) return { pass: false, code: 'EVIDENCE_PENDING_REVIEW', evidence_id: newest.id };
  if (review.decision === 'returned') {
    return { pass: false, code: 'EVIDENCE_RETURNED', evidence_id: newest.id, reason: review.reason };
  }
  return { pass: true };
}

// 豁免门：仅阻断性（blocking）豁免构成门槛失败；非阻断豁免不影响落实判定。
export function findBlockingExemption(exemptionsDoc, exemptionId) {
  if (!exemptionId) return null;
  const ex = exemptionsDoc.exemptions.find((item) => item.id === exemptionId);
  if (!ex) return { id: exemptionId, blocking: true, unregistered: true };
  return ex.blocking ? ex : null;
}

// 秘书处分解条款时生成的国内事项草稿（六要素齐备但待各国确认本国事实）。
export function draftTask(catalog, measureCode) {
  const { measures } = indexCatalog(catalog);
  const measure = measures.get(measureCode);
  if (!measure) throw new DomainError('UNKNOWN_MEASURE', `未知措施: ${measureCode}`);
  return {
    measure_code: measure.code,
    article: measure.article,
    confirmation: 'draft',
    responsible_agencies: [],
    legal_amendment: { instrument: null, status: 'draft', effective_date: null, gazette_ref: null },
    technical_interface: { system: null, status: 'build', go_live_date: null, spec_ref: null },
    budget: { status: 'requested', line: null, amount_local: null, currency: null },
    completion_evidence: [],
    exemption_id: null,
    prerequisites: [],
  };
}

// 成员国确认本国事实：六要素均须落位（证据可后补，豁免须已登记）。
export function confirmTask(task, exemptionsDoc = null) {
  const errors = [];
  if (task.responsible_agencies.length === 0) errors.push('responsible_agencies');
  if (!task.legal_amendment?.instrument) errors.push('legal_amendment.instrument');
  if (!task.technical_interface?.system) errors.push('technical_interface.system');
  if (!task.budget?.status) errors.push('budget.status');
  if (!('completion_evidence' in task)) errors.push('completion_evidence');
  if (task.exemption_id && exemptionsDoc) {
    const known = exemptionsDoc.exemptions.some((e) => e.id === task.exemption_id);
    if (!known) errors.push('exemption_id.unregistered');
  }
  if (errors.length > 0) {
    throw new DomainError('TASK_NOT_CONFIRMABLE', `事项要素不完整，无法确认: ${errors.join(', ')}`, { missing: errors });
  }
  return { ...task, confirmation: 'confirmed' };
}

function gate(pass, code, detail = {}) {
  return pass ? { pass: true } : { pass: false, code, ...detail };
}

// 评估单个成员的全部事项；prerequisites 递归解析并检测环。
export function evaluateMember(docs, catalog) {
  const { articles, measures } = indexCatalog(catalog);
  const tasks = new Map((docs.tasks?.tasks ?? []).map((t) => [t.measure_code, t]));
  const results = new Map();

  function evaluate(measureCode, stack = []) {
    if (results.has(measureCode)) return results.get(measureCode);
    if (stack.includes(measureCode)) {
      throw new DomainError('PREREQUISITE_CYCLE', `措施前置依赖存在环: ${[...stack, measureCode].join(' -> ')}`);
    }
    const measure = measures.get(measureCode);
    if (!measure) throw new DomainError('UNKNOWN_MEASURE', `未知措施: ${measureCode}`);
    const article = articles.get(measure.article);
    const task = tasks.get(measureCode);

    if (!task || task.confirmation !== 'confirmed') {
      const result = {
        member: docs.profile.member,
        measure_code: measureCode,
        article: measure.article,
        cross_border: measure.cross_border,
        confirmation: task ? task.confirmation : 'missing',
        gates: null,
        domestic_ready: false,
        implemented: false,
        ready_pending_entry: false,
        state: 'unconfirmed',
        reasons: [{ gate: 'confirmation', code: 'TASK_NOT_CONFIRMED' }],
      };
      results.set(measureCode, result);
      return result;
    }

    const nextStack = [...stack, measureCode];
    const prereqResults = (task.prerequisites ?? []).map((code) => evaluate(code, nextStack));

    const articleGate = gate(article.status === 'in_force', 'ARTICLE_NOT_IN_FORCE', { article: article.code });
    const legalStrict = task.legal_amendment.status === 'in_force';
    const legalReady = legalStrict || task.legal_amendment.status === 'enacted_not_in_force';
    const legalGate = gate(legalStrict, `LEGAL_${task.legal_amendment.status.toUpperCase()}`);
    const techPass = task.technical_interface.status === 'live';
    const techGate = gate(techPass, `TECHNICAL_${task.technical_interface.status.toUpperCase()}`);
    const budgetPass = task.budget.status === 'allocated';
    const budgetGate = gate(budgetPass, `BUDGET_${task.budget.status.toUpperCase()}`);
    const evidenceGate = evaluateEvidence(docs.evidence, task.completion_evidence);
    const blocking = findBlockingExemption(docs.exemptions, task.exemption_id);
    const exemptionGate = gate(!blocking, blocking ? (blocking.unregistered ? 'EXEMPTION_UNREGISTERED' : 'BLOCKING_EXEMPTION') : null,
      blocking ? { exemption_id: blocking.id } : {});
    const prereqImpl = prereqResults.every((r) => r.implemented);
    const prereqReady = prereqResults.every((r) => r.domestic_ready);
    const prereqGate = gate(prereqImpl, 'PREREQUISITE_NOT_IMPLEMENTED', {
      measures: prereqResults.filter((r) => !r.implemented).map((r) => r.measure_code),
    });
    const prereqReadyGate = gate(prereqReady, 'PREREQUISITE_NOT_READY', {
      measures: prereqResults.filter((r) => !r.domestic_ready).map((r) => r.measure_code),
    });

    const strictGates = [articleGate, legalGate, techGate, budgetGate, evidenceGate, exemptionGate, prereqGate];
    const implemented = strictGates.every((g) => g.pass);
    // 国内就绪：条款可暂未生效（法律允许颁布待施行），其余国内门与前置就绪均须通过。
    const domestic_ready = legalReady && techPass && budgetPass && evidenceGate.pass && !blocking && prereqReady;
    const ready_pending_entry = !articleGate.pass && domestic_ready;

    let state;
    if (implemented) state = 'implemented';
    else if (ready_pending_entry) state = 'ready_pending_entry';
    else if (legalStrict || techPass) state = 'in_progress';
    else state = 'planned';

    const reasons = [];
    for (const [name, g] of [
      ['article', articleGate], ['legal', legalGate], ['technical', techGate],
      ['budget', budgetGate], ['evidence', evidenceGate], ['exemption', exemptionGate],
      ['prerequisites', prereqGate],
    ]) {
      if (!g.pass) reasons.push({ gate: name, ...g });
    }

    const result = {
      member: docs.profile.member,
      measure_code: measureCode,
      article: measure.article,
      cross_border: measure.cross_border,
      confirmation: 'confirmed',
      gates: {
        article: articleGate,
        legal: legalGate,
        legal_readiness: { pass: legalReady },
        technical: techGate,
        budget: budgetGate,
        evidence: evidenceGate,
        exemption: exemptionGate,
        prerequisites: prereqGate,
        prerequisites_readiness: prereqReadyGate,
      },
      domestic_ready,
      implemented,
      ready_pending_entry,
      state,
      reasons,
    };
    results.set(measureCode, result);
    return result;
  }

  for (const measure of catalog.measures) evaluate(measure.code);
  return results;
}

export function evaluateAll(workspace) {
  const byMember = {};
  for (const [member, docs] of Object.entries(workspace.members)) {
    byMember[member] = evaluateMember(docs, workspace.catalog);
  }
  return byMember;
}
