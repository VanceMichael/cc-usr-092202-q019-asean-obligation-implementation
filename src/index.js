// 服务统一入口：装载案例资料并按角色提供视图。
// 角色：secretariat（秘书处）、member（成员国，需 memberId）、reviewer（法律与技术审查人员）、enterprise（企业信息发布人员）。

import { readFile } from 'node:fs/promises';
import { MatrixError, loadCase } from './model.js';
import { buildObligationMatrix, confirmOwnFact, crossBorderDependencies } from './matrix.js';
import {
  listQuarterlyReports,
  recordQuarterlyReport,
  taskAuditTrail,
} from './reporting.js';
import { evaluateAllGates, evaluateGate, gateDependencyGaps } from './recognition.js';
import { answerInquiry, listInquiries, openInquiry } from './peer.js';
import { publicMeasureCatalog, publicMeasureView } from './public.js';
import { getDocument, listDocuments, registerDocument } from './store.js';

export async function loadCaseFile(path) {
  const raw = await readFile(path, 'utf8');
  return loadCase(raw);
}

function requireRole(viewer, roles, message) {
  if (!roles.includes(viewer.role)) {
    throw new MatrixError('ROLE_FORBIDDEN', message);
  }
}

export function createSession(caseData, viewer) {
  if (!viewer || !viewer.role) {
    throw new MatrixError('BAD_VIEWER', '会话缺少角色');
  }
  if (viewer.role === 'member' && !viewer.memberId) {
    throw new MatrixError('BAD_VIEWER', '成员会话必须提供 memberId');
  }

  return {
    viewer,

    // 义务实施矩阵：成员看到本国明细、他国聚合；秘书处与审查人员看到全量明细。
    matrix() {
      if (viewer.role === 'member') {
        return buildObligationMatrix(caseData, { memberId: viewer.memberId });
      }
      return buildObligationMatrix(caseData);
    },

    confirmOwnFact(taskId, at) {
      requireRole(viewer, ['member'], '只有成员国可以确认本国事实');
      return confirmOwnFact(caseData, viewer.memberId, taskId, at);
    },

    // 跨国依赖与互认缺口由秘书处负责。
    crossBorderDependencies() {
      requireRole(viewer, ['secretariat'], '跨国依赖与互认条件由秘书处负责');
      return crossBorderDependencies(caseData);
    },

    // 季度回报仅责任成员提交；秘书处可查看全部台账。
    recordQuarterlyReport(input) {
      requireRole(viewer, ['member'], '只有成员国可以提交季度回报');
      return recordQuarterlyReport(caseData, { ...input, member_id: viewer.memberId });
    },
    listQuarterlyReports() {
      if (viewer.role === 'member') { return listQuarterlyReports(caseData, { memberId: viewer.memberId }); }
      requireRole(viewer, ['secretariat', 'reviewer'], '无权查看季度回报台账');
      return listQuarterlyReports(caseData);
    },
    taskAuditTrail(taskId) {
      const task = caseData.tasks.find((t) => t.id === taskId);
      if (!task) { throw new MatrixError('TASK_NOT_FOUND', `任务 ${taskId} 不存在`); }
      if (viewer.role === 'member' && task.member_id !== viewer.memberId) {
        throw new MatrixError('ZONE_ACCESS_DENIED', '只能追溯本国任务的审计轨迹');
      }
      requireRole(viewer, ['secretariat', 'reviewer', 'member'], '无权查看审计轨迹');
      return taskAuditTrail(caseData, taskId);
    },

    // 互认门槛：秘书处与审查人员可见完整评估；成员可查看门槛结果（用于了解互认条件）。
    evaluateGate(gateId) {
      requireRole(viewer, ['secretariat', 'reviewer', 'member'], '无权查看互认门槛评估');
      const gate = caseData.recognition_gates.find((g) => g.id === gateId);
      if (!gate) { throw new MatrixError('GATE_NOT_FOUND', `互认门槛 ${gateId} 不存在`); }
      return evaluateGate(caseData, gate);
    },
    evaluateAllGates() {
      requireRole(viewer, ['secretariat', 'reviewer', 'member'], '无权查看互认门槛评估');
      return evaluateAllGates(caseData);
    },
    gateDependencyGaps() {
      requireRole(viewer, ['secretariat'], '跨国互认缺口由秘书处维护');
      return gateDependencyGaps(caseData);
    },

    // 同行问询。
    openInquiry(input) {
      requireRole(viewer, ['member'], '只有成员国可以发起同行问询');
      return openInquiry(caseData, { ...input, from_member: viewer.memberId });
    },
    answerInquiry(input) {
      requireRole(viewer, ['member'], '只有成员国可以答复同行问询');
      return answerInquiry(caseData, { ...input, memberId: viewer.memberId });
    },
    listInquiries() {
      return listInquiries(caseData, viewer);
    },

    // 分区材料。
    listDocuments() { return listDocuments(caseData, viewer); },
    getDocument(documentId) { return getDocument(caseData, viewer, documentId); },
    registerDocument(doc) { return registerDocument(caseData, viewer, doc); },

    // 企业公开摘要：任何人拿到的都是同一套经过门槛裁剪的公开投影。
    publicMeasureCatalog() {
      return publicMeasureCatalog(caseData);
    },
    publicMeasureView(measureId, memberId) {
      return publicMeasureView(caseData, measureId, memberId);
    },
  };
}

export { MatrixError } from './model.js';
