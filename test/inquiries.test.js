import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, throwsCode } from './helpers.js';
import {
  raiseInquiry, answerInquiry, escalateInquiry, addSecretariatNote, listAllInquiries,
} from '../src/inquiries.js';
import { allRecognitionChecks, checkRecognition } from '../src/recognition.js';

const { workspace, evaluations } = await loadFixture();

test('发起问询：只能从本区成员身份发出，不能自问', () => {
  const doc = { member: 'SGP', inquiries: [] };
  const q = raiseInquiry(doc, {
    from: 'SGP', to: 'THA', measure_code: 'M-AEO', raised_at: '2026-09-26',
    subject: '对账周期', body: '请确认企业编号对账周期请确认', due_at: '2026-10-26',
  });
  assert.equal(q.status, 'open');
  throwsCode(() => raiseInquiry(doc, {
    from: 'SGP', to: 'SGP', raised_at: '2026-09-26', subject: 'x', body: 'yy',
  }), 'SELF_INQUIRY');
  throwsCode(() => raiseInquiry({ member: 'BRN', inquiries: [] }, {
    from: 'SGP', to: 'THA', raised_at: '2026-09-26', subject: 'x', body: 'yy',
  }), 'ZONE_MISMATCH');
});

test('只有被问询成员可以作答，且答复追加留痕', () => {
  const doc = structuredClone(workspace.members.BRN.inquiries);
  // 提问方 SGP 不能替 BRN 回答
  throwsCode(() => answerInquiry(doc, 'Q-SGP-BRN-001', {
    by: 'SGP', at: '2026-09-26', text: '自问自答自问自答自问自答',
  }), 'NOT_RESPONDENT');
  // 已作答的问询在文莱分区可再追加以演示线程累积
  const q = answerInquiry(doc, 'Q-SGP-BRN-001', {
    by: 'BRN', at: '2026-09-26', text: '补充：报文联调记录可向秘书处索取补充',
  });
  assert.equal(q.status, 'answered');
  assert.ok(q.thread.some((t) => t.kind === 'answer' && t.by === 'BRN'));
});

test('秘书处可登记跨国依赖说明，但不替代作答', () => {
  const doc = structuredClone(workspace.members.THA.inquiries);
  const q = addSecretariatNote(doc, 'Q-SGP-THA-003', {
    at: '2026-09-12', text: '该问题已登记为双边技术事项', dependency_id: 'DEP-AEO-SGP-THA-NEW',
  });
  const note = q.thread.find((t) => t.kind === 'note');
  assert.equal(note.dependency_id, 'DEP-AEO-SGP-THA-NEW');
  assert.equal(q.status, 'open', '秘书处说明不改变问询开放状态');
});

test('超期未答复可升级且原因留痕；未到期不能升级', () => {
  const doc = {
    member: 'THA',
    inquiries: structuredClone(workspace.members.THA.inquiries.inquiries),
  };
  throwsCode(() => escalateInquiry(doc, 'Q-SGP-THA-003', {
    at: '2026-10-01', reason: '催办后仍无答复且影响企业通关安排',
  }), 'NOT_OVERDUE');
  const q = escalateInquiry(doc, 'Q-SGP-THA-003', {
    at: '2026-10-11', reason: '超过答复期限一日仍未回复，企业通关安排受阻',
  });
  assert.equal(q.status, 'escalated');
  assert.equal(q.thread.at(-1).kind, 'escalation');
});

test('秘书处汇总视角合并各分区镜像并按线程完整度去重', () => {
  const all = listAllInquiries(workspace);
  const dse = all.find((q) => q.id === 'Q-SGP-BRN-001');
  assert.equal(dse.thread.length, 1, '应取含答复的镜像');
  assert.ok(all.some((q) => q.id === 'Q-THA-BRN-002'));
});

test('互认检查：SGP–THA 的 AEO 全部门槛通过', () => {
  const result = checkRecognition(workspace, evaluations, 'M-AEO', 'SGP', 'THA');
  assert.equal(result.verdict, 'recognition_ready');
  assert.equal(result.pass, true);
  assert.equal(result.conformity_ref, 'ASEAN-AEO-CERT-SGP-THA-2026-08');
  assert.equal(result.arrangement_id, 'ARR-AEO-SGP-THA');
});

test('互认检查：SGP–BRN 的 AEO 被国内门、符合性、安排与依赖登记多重阻断', () => {
  const result = checkRecognition(workspace, evaluations, 'M-AEO', 'SGP', 'BRN');
  assert.equal(result.verdict, 'not_ready');
  const failed = Object.fromEntries(result.gates.map((g) => [g.gate, g]));
  assert.equal(failed.domestic.pass, false);
  assert.equal(failed.domestic.sides.find((s) => s.member === 'BRN').pass, false);
  assert.equal(failed.bilateral_conformity.pass, false);
  assert.equal(failed.bilateral_conformity.code, 'CONFORMITY_NOT_RUN');
  assert.equal(failed.arrangement.pass, false);
  assert.equal(failed.dependency_clear.pass, false);
  assert.equal(failed.dependency_clear.dependency_id, 'DEP-AEO-SGP-BRN');
});

test('互认检查：DEFA-12 未生效，电子签名互认一律不达标', () => {
  const result = checkRecognition(workspace, evaluations, 'M-ESIG', 'SGP', 'BRN');
  assert.equal(result.verdict, 'not_ready');
  assert.equal(result.gates[0].gate, 'article');
  assert.equal(result.gates[0].code, 'ARTICLE_NOT_IN_FORCE');
});

test('全量互认检查：单一窗口 SGP–THA / SGP–BRN 通过，THA–BRN 因符合性未测不达标', () => {
  const rows = allRecognitionChecks(workspace, evaluations);
  const find = (measure, a, b) => rows.find((r) =>
    r.measure_code === measure && r.pair.join() === [a, b].sort().join());
  assert.equal(find('M-DSE', 'SGP', 'THA').pass, true);
  assert.equal(find('M-DSE', 'SGP', 'BRN').pass, true);
  assert.equal(find('M-DSE', 'THA', 'BRN').pass, false);
});

test('非跨境措施不做互认检查', () => {
  assert.throws(() => checkRecognition(workspace, evaluations, 'M-ETR', 'SGP', 'THA'), /不是跨境措施/);
});
