# 东盟协定义务实施矩阵

把东盟正式协定（数字经济框架协议、货物贸易议定书、东盟单一窗口议定书等）条款拆成成员国海关、电子交易与平台监管部门**可执行的国内事项**，并在签署准备阶段持续跟踪：责任机关、法律修订、技术接口、预算、完成证据与适用豁免。

核心分工：

- **成员国**只确认本国事实、提交本国任务的季度回报、发起同行问询；
- **东盟秘书处**负责矩阵装配、跨国依赖、互认条件与缺口；
- **法律与技术审查人员**审查证据（含退回）；
- **企业信息发布人员/企业**只能看到经门槛裁剪后的公开措施状态。

## 关键业务规则

1. **未生效条款不得标记为已落实。** 申报 `implemented` 时逐项检查：条款生效状态、法律修订已颁布、技术接口一致性通过、预算批复、证据通过审查、本国事实已确认。被阻断的申报被拒绝并写入不可删除的 `rejected_intake` 留痕，任务状态不变。境内条件全部具备但条款未生效的，派生状态为 `domestically_ready`（已备妥，不得称已落实）。
2. **计划调整、期限延长、部分完成、证据退回必须保留原因。** 期限延长须注明原期限/新期限，证据退回须关联证据编号；全部进入任务审计轨迹。
3. **互认门槛**由法律等效、技术一致性、证据审查三类标准组成：逐成员判定；双边门槛逐对成员判定；豁免（如最不发达成员过渡期）成员标记为过渡期而非达标；条款未生效时门槛不激活。
4. **企业公开摘要**只显示同时具备法律与技术条件、且证据通过审查的措施状态（`available`）；其余为 `尚未生效` / `过渡期` / `暂不可用`，不暴露退回原因、预算、草案等内部细节。
5. **多国敏感材料分区保存**：
   - `public`：公开（企业可见）；
   - `members`：全体成员与秘书处、审查人员可见；
   - `restricted:<成员>`：仅秘书处与该成员可见；审查人员因履职可调取其中的退回证据包，看不到预算明细、立法草案等其他受限材料。
6. **成员视角隔离**：成员查看矩阵时，他国任务降级为聚合状态（成员、派生状态、是否豁免、是否已确认），不展示明细。

## 目录说明

- `contracts/domain.schema.json` — 共享资料基础字段契约。
- `contracts/case.schema.json` — 完整案例资料契约（协定/义务/任务/证据/回报/门槛/问询/措施/分区材料）。
- `fixtures/context.json` — 最小公开样例（不含真实个人信息）。
- `fixtures/case.json` — 成员与措施样例：5 个成员、3 份协定、5 项义务、任务分解、证据受理与退回、季度回报（含延长期限原因）、3 道互认门槛、同行问询、3 项企业便利化措施与多分区材料。均为合成数据，无账号、密钥或连接凭据。
- `src/model.js` — 资料装载、引用完整性、阻断规则、豁免有效性、派生实施状态。
- `src/matrix.js` — 义务实施矩阵装配、本国事实确认、跨国依赖汇总。
- `src/reporting.js` — 季度回报受理（原因强制、未生效阻断、留痕）与任务审计轨迹。
- `src/recognition.js` — 互认门槛逐成员/双边评估与缺口清单。
- `src/peer.js` — 同行问询的发起、答复与当事方可见性。
- `src/public.js` — 企业公开措施目录与单项措施视图。
- `src/store.js` — 分区材料登记与访问控制。
- `src/index.js` — `createSession(caseData, viewer)` 角色门面，供后续服务统一接入。

## 使用方式

```js
import { loadCaseFile, createSession } from './src/index.js';

const data = await loadCaseFile(new URL('./fixtures/case.json', import.meta.url));

const secretariat = createSession(data, { role: 'secretariat' });
secretariat.gateDependencyGaps();              // 秘书处：跨国互认缺口
secretariat.taskAuditTrail('t-kh-eco');        // 原因留痕审计轨迹

const kh = createSession(data, { role: 'member', memberId: 'KH' });
kh.recordQuarterlyReport({ /* 季度回报，变更必须带原因 */ });

const enterprise = createSession(data, { role: 'enterprise' });
enterprise.publicMeasureView('fm-eco', 'SG');  // 只返回公开状态
```

## 本地检查

```
npm test
```

测试覆盖：任务分解、未生效阻断与留痕、季度回报原因强制、证据退回留痕、本国事实确认边界、互认门槛与双边资格、问询可见性、企业公开裁剪、分区访问控制与成员视角隔离。
