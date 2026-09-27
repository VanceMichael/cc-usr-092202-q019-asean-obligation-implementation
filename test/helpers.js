import assert from 'node:assert/strict';
import { loadWorkspace } from '../src/zones.js';
import { evaluateAll } from '../src/matrix.js';

export const ZONE_ROOT = new URL('../fixtures/zones/', import.meta.url);

export async function loadFixture() {
  const workspace = await loadWorkspace(ZONE_ROOT, 'secretariat');
  const evaluations = evaluateAll(workspace);
  return { workspace, evaluations };
}

// 领域错误以 code 判定，不依赖中文消息措辞。
export function throwsCode(fn, code) {
  assert.throws(fn, (err) => err.code === code, `应抛出错误码 ${code}`);
}
