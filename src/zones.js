// 多国敏感材料分区保存与访问控制。
//
// 三类分区：
//   public                 公共区：企业可见的目录与公开摘要，仅秘书处发布流程可写
//   secretariat            秘书处区：跨国依赖、双边符合性、互认门槛，仅秘书处可写
//   member:<三位国家代码>   成员国区：本国事实（任务/证据/豁免/回报/问询），仅本国可写
//
// 成员国只能读写本国分区；秘书处与审查人员可读所有成员国区；
// 其他成员国、企业、发布人员均不得读取他国分区。

import { readFile, readdir, writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_ZONE = 'public';
export const SECRETARIAT_ZONE = 'secretariat';

const MEMBER_CODE_RE = /^[A-Z]{3}$/;
const MEMBER_DIR_RE = /^member-([a-z]{3})$/;

// 角色 → 分区权限。秘书处可读全部、写公共区与秘书处区；
// 成员国对本国分区可读写；审查人员只读；企业与发布人员只读公共区。
const ROLE_MATRIX = {
  secretariat: { readZones: 'all', writeZones: [PUBLIC_ZONE, SECRETARIAT_ZONE] },
  reviewer: { readZones: 'all', writeZones: [] },
  publisher: { readZones: [PUBLIC_ZONE], writeZones: [] },
  enterprise: { readZones: [PUBLIC_ZONE], writeZones: [] },
};

export class PermissionError extends Error {
  constructor(role, zone, op) {
    super(`角色 ${role} 无权${op === 'write' ? '写入' : '读取'}分区 ${zone}`);
    this.name = 'PermissionError';
    this.role = role;
    this.zone = zone;
    this.op = op;
  }
}

export function parseZone(zone) {
  if (zone === PUBLIC_ZONE) return { kind: 'public' };
  if (zone === SECRETARIAT_ZONE) return { kind: 'secretariat' };
  if (typeof zone === 'string' && zone.startsWith('member:')) {
    const member = zone.slice('member:'.length);
    if (!MEMBER_CODE_RE.test(member)) {
      throw new Error(`成员国分区标识无效: ${zone}`);
    }
    return { kind: 'member', member };
  }
  throw new Error(`未知分区: ${zone}`);
}

export function roleForMember(member) {
  if (!MEMBER_CODE_RE.test(member)) throw new Error(`成员国代码无效: ${member}`);
  return `member:${member}`;
}

function zoneMatches(zone, allowed) {
  if (allowed === 'all') return true;
  if (Array.isArray(allowed)) {
    return allowed.some((pattern) => {
      if (pattern === zone) return true;
      // 成员国角色对 member:<本国> 精确匹配
      return pattern === zone;
    });
  }
  return false;
}

// 判定某角色能否对分区执行 read/write。
export function can(role, zone, op) {
  parseZone(zone);
  if (role.startsWith('member:')) {
    const own = parseZone(role).member;
    const target = parseZone(zone);
    if (op === 'write') return target.kind === 'member' && target.member === own;
    // 成员国可读本国分区与公共区
    return target.kind === 'member' && target.member === own || target.kind === 'public';
  }
  const entry = ROLE_MATRIX[role];
  if (!entry) return false;
  const allowed = op === 'write' ? entry.writeZones : entry.readZones;
  return zoneMatches(zone, allowed);
}

export function assertAccess(role, zone, op) {
  if (!can(role, zone, op)) throw new PermissionError(role, zone, op);
}

// 分区 → 磁盘目录（公共区不带前缀，其余与敏感区一一对应）。
export function zoneDir(root, zone) {
  const base = root instanceof URL ? fileURLToPath(root) : root;
  const parsed = parseZone(zone);
  if (parsed.kind === 'public') return join(base, 'public');
  if (parsed.kind === 'secretariat') return join(base, 'secretariat');
  return join(base, `member-${parsed.member.toLowerCase()}`);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 带访问控制的读取：先过权限门，再落盘。
export async function readZonedJson(root, zone, file, actor) {
  assertAccess(actor, zone, 'read');
  return readJson(join(zoneDir(root, zone), file));
}

// 带访问控制的写入；成员国只能写本国事实文件。
export async function writeZonedJson(root, zone, file, value, actor) {
  assertAccess(actor, zone, 'write');
  const dir = zoneDir(root, zone);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const MEMBER_DOCS = ['profile.json', 'tasks.json', 'evidence.json', 'exemptions.json', 'reports.json', 'inquiries.json'];

// 加载整个工作区（供秘书处侧汇总逻辑使用，调用方须为 secretariat/reviewer）。
// 返回公共目录、各成员国事实文档与秘书处文档，并校验目录名与文档自称分区一致。
export async function loadWorkspace(root, actor = 'secretariat') {
  assertAccess(actor, SECRETARIAT_ZONE, 'read');
  const base = root instanceof URL ? fileURLToPath(root) : root;
  const catalog = await readJson(join(base, 'public', 'catalog.json'));
  const secretariat = {
    dependencies: await readJson(join(base, 'secretariat', 'dependencies.json')),
    conformity: await readJson(join(base, 'secretariat', 'conformity.json')),
    thresholds: await readJson(join(base, 'secretariat', 'recognition_thresholds.json')),
  };
  const entries = await readdir(base, { withFileTypes: true });
  const members = {};
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(MEMBER_DIR_RE);
    if (!match) continue;
    const member = match[1].toUpperCase();
    const dir = join(base, entry.name);
    const docs = {};
    for (const file of MEMBER_DOCS) {
      if (await exists(join(dir, file))) {
        docs[file.replace('.json', '')] = await readJson(join(dir, file));
      }
    }
    const profile = docs.profile;
    if (!profile || profile.member !== member || profile.zone !== `member:${member}`) {
      throw new Error(`成员国分区 ${entry.name} 与 profile 标识不一致`);
    }
    for (const doc of Object.values(docs)) {
      if (doc && doc.member !== undefined && doc.member !== member) {
        throw new Error(`分区 ${entry.name} 内含其他成员国 ${doc.member} 的资料`);
      }
    }
    members[member] = docs;
  }
  return { catalog, secretariat, members };
}
