// 互认门槛检查（秘书处职责）：判定跨境措施在一对成员之间是否具备互认条件。
//
// 每道门槛：
//   1. 条款已生效（未生效条款不产生互认义务）
//   2. 双方国内门槛全部通过（法律/技术/预算/证据/阻断性豁免/前置措施）
//   3. 双边符合性测试按门槛配置的接口规范通过
//   4. 门槛配置要求时，互认安排已签署生效
//   5. 秘书处跨国依赖登记中不存在阻断项
//
// 企业公开视图只看本检查的最终 verdict，不看门槛明细。

import { indexCatalog } from './catalog.js';

export function pairKey(a, b) {
  return [a, b].sort().join('-');
}

function findConformity(conformityDoc, measureCode, a, b) {
  return conformityDoc.results.find(
    (r) => r.measure_code === measureCode && pairKey(r.pair[0], r.pair[1]) === pairKey(a, b),
  ) ?? null;
}

function findArrangement(conformityDoc, measureCode, a, b) {
  return (conformityDoc.arrangements ?? []).find(
    (r) => r.measure_code === measureCode && pairKey(r.pair[0], r.pair[1]) === pairKey(a, b),
  ) ?? null;
}

function findBlockingDependency(dependenciesDoc, measureCode, a, b) {
  return (dependenciesDoc.dependencies ?? []).find((d) => {
    if (d.measure_code !== measureCode || d.status !== 'blocked') return false;
    if (d.members === 'ALL') return true;
    return Array.isArray(d.members) &&
      pairKey(d.members[0], d.members[1]) === pairKey(a, b);
  }) ?? null;
}

// 检查一对成员在某跨境措施上的互认条件。evaluations 为 evaluateAll 的结果。
export function checkRecognition(workspace, evaluations, measureCode, a, b) {
  const { measures } = indexCatalog(workspace.catalog);
  const measure = measures.get(measureCode);
  if (!measure) throw new Error(`未知措施: ${measureCode}`);
  if (!measure.cross_border) {
    throw new Error(`措施 ${measureCode} 不是跨境措施，无需互认检查`);
  }
  const threshold = workspace.secretariat.thresholds.thresholds.find((t) => t.measure_code === measureCode);
  if (!threshold) throw new Error(`秘书处缺少措施 ${measureCode} 的互认门槛配置`);

  const gates = [];

  const article = workspace.catalog.agreements
    .flatMap((ag) => ag.articles).find((art) => art.code === measure.article);
  gates.push({
    gate: 'article', pass: article.status === 'in_force',
    code: article.status === 'in_force' ? null : 'ARTICLE_NOT_IN_FORCE',
  });

  const sides = [];
  for (const member of [a, b]) {
    const ev = evaluations[member]?.get(measureCode);
    const domesticPass = Boolean(ev?.implemented);
    sides.push({ member, pass: domesticPass, state: ev?.state ?? 'unknown', failed_gates: (ev?.reasons ?? []).map((r) => r.gate) });
  }
  gates.push({ gate: 'domestic', pass: sides.every((s) => s.pass), sides });

  const conformity = findConformity(workspace.secretariat.conformity, measureCode, a, b);
  const conformityPass = conformity?.result === 'passed' &&
    (!threshold.conformity_spec || conformity.spec_ref === threshold.conformity_spec);
  gates.push({
    gate: 'bilateral_conformity',
    pass: conformityPass,
    code: !conformity ? 'CONFORMITY_NOT_RUN'
      : conformity.result !== 'passed' ? `CONFORMITY_${conformity.result.toUpperCase()}`
        : conformity.spec_ref !== threshold.conformity_spec ? 'CONFORMITY_SPEC_MISMATCH' : null,
    result: conformity ? conformity.result : 'missing',
  });

  let arrangement = null;
  if (threshold.requires_arrangement) {
    arrangement = findArrangement(workspace.secretariat.conformity, measureCode, a, b);
    gates.push({
      gate: 'arrangement',
      pass: arrangement?.status === 'in_force',
      code: !arrangement ? 'ARRANGEMENT_MISSING' : 'ARRANGEMENT_NOT_IN_FORCE',
    });
  }

  const dependency = findBlockingDependency(workspace.secretariat.dependencies, measureCode, a, b);
  gates.push({
    gate: 'dependency_clear',
    pass: !dependency,
    code: dependency ? 'BLOCKING_DEPENDENCY_REGISTERED' : null,
    dependency_id: dependency?.id ?? null,
  });

  const pass = gates.every((g) => g.pass);
  return {
    measure_code: measureCode,
    pair: [a, b].sort(),
    verdict: pass ? 'recognition_ready' : 'not_ready',
    pass,
    gates,
    conformity_ref: conformity?.cert_ref ?? null,
    arrangement_id: arrangement?.id ?? null,
  };
}

// 某成员视角：列出其与各伙伴在全部跨境措施上的互认状态。
export function recognitionMatrix(workspace, evaluations, member) {
  const partners = Object.keys(workspace.members).filter((m) => m !== member).sort();
  const rows = [];
  for (const measure of workspace.catalog.measures.filter((m) => m.cross_border)) {
    for (const partner of partners) {
      rows.push(checkRecognition(workspace, evaluations, measure.code, member, partner));
    }
  }
  return rows;
}

// 秘书处发布视角：全部跨境措施 × 全部无序成员对，每对只检查一次。
export function allRecognitionChecks(workspace, evaluations) {
  const members = Object.keys(workspace.members).sort();
  const rows = [];
  for (const measure of workspace.catalog.measures.filter((m) => m.cross_border)) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        rows.push(checkRecognition(workspace, evaluations, measure.code, members[i], members[j]));
      }
    }
  }
  return rows;
}
