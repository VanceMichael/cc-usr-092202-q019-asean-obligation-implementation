// 公开摘要：秘书处把内部评估结果发布到公共区，企业只从公共区读取。
//
// 信息最小化：摘要只含措施标题、成员、是否可用、生效/上线时间。
// 预算、法律文本细目、证据退回原因、期限延长、计划调整、豁免、问询等内部信息一律不发布。
// 企业对任何不满足全部条件的措施只能看到中性的 not_available，无法推断原因。

import { indexCatalog } from './catalog.js';

// 由秘书处汇总内部工作区，生成可发布的公开摘要文档。
// recognitionRows 为 recognition.recognitionMatrix 风格的双边互认结果（可选）。
export function buildPublicSummary(workspace, evaluations, recognitionRows = [], publishedAt) {
  const { articles, measures } = indexCatalog(workspace.catalog);
  const memberNames = new Map(
    Object.entries(workspace.members).map(([code, docs]) => [code, docs.profile.name]),
  );

  const entries = [];
  for (const measure of workspace.catalog.measures) {
    const article = articles.get(measure.article);
    for (const member of Object.keys(workspace.members).sort()) {
      const result = evaluations[member]?.get(measure.code);
      const task = workspace.members[member].tasks?.tasks?.find((t) => t.measure_code === measure.code);
      // 只有条款生效、各道国内门（含法律、技术、证据接受）全部通过才发布为 available。
      const available = Boolean(result?.implemented);
      const entry = {
        measure_code: measure.code,
        measure_title: measure.title,
        domains: measure.domains,
        cross_border: measure.cross_border,
        member,
        member_name: memberNames.get(member) ?? member,
        status: available ? 'available' : 'not_available',
      };
      if (available) {
        // 仅公开企业实际可用的最早日期：法律生效日与系统上线日的较晚者。
        const dates = [task.legal_amendment.effective_date, task.technical_interface.go_live_date]
          .filter(Boolean).sort();
        entry.available_from = dates[dates.length - 1] ?? article.effective_date;
      }
      entries.push(entry);
    }
  }

  // 跨境措施：只发布通过全部互认门槛的成员对；其余成员对不出现在公开列表中
  // （而不是发布 not_ready，避免泄露哪一方未达标）。按成员对去重（双边矩阵会各产生一行）。
  const recognition = [];
  const seenPairs = new Set();
  for (const row of recognitionRows) {
    if (!row.pass) continue;
    const key = `${row.measure_code}:${row.pair.join('-')}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const measure = measures.get(row.measure_code);
    recognition.push({
      measure_code: row.measure_code,
      measure_title: measure.title,
      pair: row.pair,
      status: 'available',
      conformity_ref: row.conformity_ref,
    });
  }

  return {
    doc: 'public_implementation_summary',
    published_at: publishedAt,
    published_by: 'ASEAN Secretariat',
    catalog_version: workspace.catalog.catalog_version,
    entries,
    recognition,
  };
}

// ---- 企业端视图：只读公开摘要，不接触任何成员/秘书处分区 ----

// 企业查看某成员境内的措施清单：不可用项只有中性状态，无原因、无预计时间。
export function enterpriseMemberView(summary, member) {
  return summary.entries
    .filter((e) => e.member === member)
    .map((e) => ({
      measure_code: e.measure_code,
      measure_title: e.measure_title,
      domains: e.domains,
      cross_border: e.cross_border,
      status: e.status === 'available' ? 'available' : 'not_available',
      ...(e.status === 'available' ? { available_from: e.available_from } : {}),
    }));
}

// 企业查看某项便利化措施：各国状态 + （跨境措施）已具备互认条件的成员对。
export function enterpriseMeasureView(summary, measureCode) {
  const entries = summary.entries.filter((e) => e.measure_code === measureCode);
  if (entries.length === 0) return null;
  const first = entries[0];
  const view = {
    measure_code: measureCode,
    measure_title: first.measure_title,
    domains: first.domains,
    cross_border: first.cross_border,
    by_member: entries.map((e) => ({
      member: e.member,
      member_name: e.member_name,
      status: e.status === 'available' ? 'available' : 'not_available',
      ...(e.status === 'available' ? { available_from: e.available_from } : {}),
    })),
  };
  if (first.cross_border) {
    // 仅列已可用的成员对；未达门槛的成员对不出现。
    view.recognition_pairs = summary.recognition
      .filter((r) => r.measure_code === measureCode && r.status === 'available')
      .map((r) => ({ pair: r.pair, status: 'available', conformity_ref: r.conformity_ref }));
  }
  return view;
}
