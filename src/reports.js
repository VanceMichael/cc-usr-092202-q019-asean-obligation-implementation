// 季度回报：成员国按季度回报实施状态。
//
// 留因规则（原因随回报永久保留，供秘书处追溯）：
//   plan_adjustment    国内计划调整  → 必须填 reason，可有新旧期限
//   extension          期限延长      → 必须填 reason、previous_deadline、revised_deadline
//   partial            部分完成      → 必须填 reason
//   证据被退回后更正    → 必须引用新证据并说明更正原因
//
// 硬规则：条款未生效时，状态一律不得申报为 implemented（未生效条款不得被标成已落实）。

import { DomainError } from './util.js';

const VALID_STATES = ['implemented', 'partial', 'in_progress', 'planned', 'ready_pending_entry'];
const CHANGES_REQUIRING_REASON = new Set(['plan_adjustment', 'extension', 'partial_completion', 'evidence_correction']);

function assert(cond, code, message, extra) {
  if (!cond) throw new DomainError(code, message, extra);
}

// 校验单条季度更新；articleStatus 取自公共目录，evidenceState 由证据文档判定。
export function validateUpdate(update, { articleStatus, knownMeasures }) {
  assert(knownMeasures.has(update.measure_code), 'UNKNOWN_MEASURE', `未知措施: ${update.measure_code}`);
  assert(VALID_STATES.includes(update.state), 'INVALID_STATE', `回报状态无效: ${update.state}`);

  if (update.state === 'implemented') {
    assert(articleStatus === 'in_force', 'ARTICLE_NOT_IN_FORCE',
      `条款未生效，措施 ${update.measure_code} 不得申报为已落实`, { measure_code: update.measure_code });
    assert(Array.isArray(update.evidence_ids) && update.evidence_ids.length > 0,
      'EVIDENCE_REQUIRED', `申报已落实必须附完成证据: ${update.measure_code}`);
    assert(!update.change, 'IMPLEMENTED_WITHOUT_CHANGE',
      `措施 ${update.measure_code} 已落实时不应附带变更类型`);
  }

  if (update.change) {
    assert(CHANGES_REQUIRING_REASON.has(update.change), 'INVALID_CHANGE',
      `变更类型无效: ${update.change}`);
    assert(typeof update.reason === 'string' && update.reason.trim().length >= 10,
      'REASON_REQUIRED', `变更 ${update.change} 必须保留不少于10字的原因`, { measure_code: update.measure_code });
  }

  if (update.change === 'extension') {
    assert(update.previous_deadline && update.revised_deadline, 'DEADLINE_REQUIRED',
      '期限延长必须记录原期限与修订后期限');
    assert(update.revised_deadline > update.previous_deadline, 'DEADLINE_NOT_EXTENDED',
      '修订后期限必须晚于原期限');
  }

  if (update.state === 'partial') {
    assert(typeof update.reason === 'string' && update.reason.trim().length >= 10,
      'PARTIAL_REASON_REQUIRED', `部分完成必须说明原因: ${update.measure_code}`);
  }

  // 证据更正：新证据不得与历史已退回证据相同（防止拿同一材料重复冲抵）。
  if (update.change === 'evidence_correction') {
    assert(Array.isArray(update.evidence_ids) && update.evidence_ids.length > 0,
      'CORRECTION_EVIDENCE_REQUIRED', '证据更正必须附新材料');
  }
  return true;
}

// 编制并校验一份季度回报文档（纯函数：返回带时间戳的新回报，不改动入参）。
export function buildQuarterlyReport(member, quarter, submittedAt, updates, context) {
  assert(Array.isArray(updates) && updates.length > 0, 'EMPTY_REPORT', '季度回报不得为空');
  const seen = new Set();
  for (const update of updates) {
    assert(!seen.has(update.measure_code), 'DUPLICATE_UPDATE',
      `同一季度内措施重复回报: ${update.measure_code}`);
    seen.add(update.measure_code);
    validateUpdate(update, context);
  }
  return {
    id: `R-${member}-${quarter}`,
    quarter,
    submitted_at: submittedAt,
    updates,
  };
}

// 汇总各季度最新状态，形成成员—措施的当前回报视图（保留全部历史变更与原因）。
export function latestReportedStates(reportsDoc) {
  const latest = new Map();
  const history = [];
  for (const report of [...(reportsDoc?.reports ?? [])].sort((a, b) => a.quarter.localeCompare(b.quarter))) {
    for (const update of report.updates) {
      history.push({ quarter: report.quarter, ...update });
      latest.set(update.measure_code, { quarter: report.quarter, ...update });
    }
  }
  return { latest, history };
}
