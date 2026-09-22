// 多国敏感材料分区保存与访问控制。
// 分区：public（公开）、members（全体成员与秘书处）、restricted:<成员>（仅秘书处与该成员）。
// 审查人员因履职需要可调取退回证据包，但看不到预算明细、内部立法草案等其他受限材料。

import { MatrixError } from './model.js';

// viewer: { role: 'secretariat' | 'member' | 'reviewer' | 'enterprise', memberId? }
export function canAccessZone(viewer, doc) {
  const zone = doc.zone;
  if (zone === 'public') { return true; }
  if (viewer.role === 'secretariat') { return true; }
  if (zone === 'members') { return viewer.role === 'member' || viewer.role === 'reviewer'; }
  if (zone.startsWith('restricted:')) {
    const owner = zone.slice('restricted:'.length);
    if (viewer.role === 'member' && viewer.memberId === owner) { return true; }
    if (viewer.role === 'reviewer' && doc.kind === 'returned_evidence_pack') { return true; }
    return false;
  }
  return false;
}

export function listDocuments(caseData, viewer) {
  return caseData.documents
    .filter((doc) => canAccessZone(viewer, doc))
    .map((doc) => ({ ...doc }));
}

export function getDocument(caseData, viewer, documentId) {
  const doc = caseData.documents.find((d) => d.id === documentId);
  if (!doc) { throw new MatrixError('DOCUMENT_NOT_FOUND', `资料 ${documentId} 不存在`); }
  if (!canAccessZone(viewer, doc)) {
    throw new MatrixError('ZONE_ACCESS_DENIED', '该资料保存在其他成员的受限分区，无权查看');
  }
  return { ...doc };
}

// 向受限分区登记材料：成员只能写入本国分区；秘书处可写 members 分区；公开材料由发布角色写入。
export function registerDocument(caseData, viewer, doc) {
  const zone = doc.zone;
  if (zone === 'restricted:') {
    throw new MatrixError('BAD_ZONE', '受限分区必须标明成员，如 restricted:TH');
  }
  if (zone.startsWith('restricted:')) {
    const owner = zone.slice('restricted:'.length);
    if (viewer.role !== 'secretariat' && !(viewer.role === 'member' && viewer.memberId === owner)) {
      throw new MatrixError('ZONE_ACCESS_DENIED', '只能向本国受限分区登记材料');
    }
    doc.member_id = owner;
  } else if (zone === 'members') {
    if (viewer.role !== 'secretariat') {
      throw new MatrixError('ZONE_ACCESS_DENIED', '成员级共享材料由秘书处登记');
    }
  } else if (zone === 'public') {
    if (!['secretariat', 'enterprise'].includes(viewer.role)) {
      throw new MatrixError('ZONE_ACCESS_DENIED', '公开材料由秘书处或企业信息发布人员登记');
    }
  } else {
    throw new MatrixError('BAD_ZONE', `未知分区：${zone}`);
  }
  if (caseData.documents.some((d) => d.id === doc.id)) {
    throw new MatrixError('DUPLICATE_DOCUMENT', `材料已登记：${doc.id}`);
  }
  caseData.documents.push({ ...doc });
  return { ...doc };
}
