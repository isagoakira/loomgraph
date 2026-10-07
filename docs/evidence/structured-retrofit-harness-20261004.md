# Structured retrofit harness / display facts 只读审计（2026-10-04）

## 结论

纯模块 benchmark 证明组织投影本身可以在 500 个 task placement 上完成，但当前 expression context 的字节预算会在大组织上下文上主动降级；带 500 个 browser visible refs 和 geometry 的 64 KiB 请求最终只返回 `insufficient_context` 的最小 envelope，`nodes=0`、`visibleRefs=0`、`geometry=0`。因此，不能把 context 返回成功、组织投影成功或 display facts 曾经被接收，表述成页面已经显示或完成了浏览器渲染验收。

同一 fixture 的纯组织 view/plan 函数分别在中位约 8.8 ms / 6.5 ms 内处理 500 个 refs；30 个带冻结组织选择的 annotations 生成 organization observations 的中位约 12.8 ms，但序列化结果约 1.23 MB。当前测试覆盖小型 fixture、预算裁剪、display facts 的 revision/epoch/build 防护、单批注冻结反馈，以及 500-node expression context 的最终字节预算和局部投影回归；仍没有正式的 500-geometry server regression 或 annotation observation 分页预算。

## 审计范围与运行方式

本轮只读检查以下模块与测试：

- expression context：`src/expression/context.ts`、`src/expression/types.ts`；
- organization projection：`src/layout/organization.ts`、`src/layout/organization-view.ts`；
- frozen organization feedback：`src/core/organization-feedback.ts`；
- display facts server path：`src/server/index.ts`、`src/contracts/display-facts.ts`；
- `tests/expression-harness.test.ts`、`tests/server-display-facts.test.ts`、`tests/organization.test.ts`、`tests/organization-view.test.ts`、`tests/organization-feedback.test.ts`。

benchmark 入口已固化为仓库脚本 `scripts/structured-retrofit-bench.ts`，通过纯本地 esbuild bundle 后执行：

```sh
cd /Users/Zhuanz1/Desktop/file/AutoResearch/plugins/agent-visual-canvas
./node_modules/.bin/esbuild scripts/structured-retrofit-bench.ts \
  --bundle --platform=node --format=esm \
  --outfile=/tmp/structured-retrofit-bench.mjs
node /tmp/structured-retrofit-bench.mjs
```

环境为 Node `v26.8.1`、esbuild `0.25.12`、Vitest `3.2.7`。入口只导入表达式、布局和反馈纯函数，没有启动 `startCanvasServer`、没有 HTTP 请求、没有写入 revision，也没有修改 live/workCopy/UI/layout source。

fixture 固定为：

- 500 个 task entity、500 个 representation，单 graph `g`，source 为合成的 `source://task/i`；
- 一个包含 500 个 refs 的 organization cluster，500 个 browser visible refs 和 500 个 measured geometry；
- 30 个 annotations，每个 annotation 带一个冻结的 cluster organization anchor，观察 revision 为 `7`，每个 anchor 选中 500 个 refs；
- snapshot revision 从 `7` 开始，benchmark 前后比较 revision；没有 relations/free elements/runs；
- context 场景使用 `maxBytes=64 KiB`、`30 KiB`，并保留 `maxNodes=300`、`maxClusters=120`、`maxOrganizationLinks=240` 等 hard limit 范围。

## 500 nodes / 500 display refs 的 expression context

以下 timing 是每个场景 7 次执行的中位数，bytes 是 `JSON.stringify(context)` 的 UTF-8 字节数。

| 场景 | median | 输出 bytes | status | nodes | organization clusters | browser visible / geometry |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| 64 KiB，完整 organization + current browser facts | 1664.930 ms | 2,381 | `insufficient_context` | 0 | 0 | 0 / 0 |
| 30 KiB，完整 organization + current browser facts | 1657.661 ms | 2,381 | `insufficient_context` | 0 | 0 | 0 / 0 |
| 64 KiB，无 browser facts，完整 organization | 594.344 ms | 2,223 | `insufficient_context` | 0 | 0 | 不适用 |
| 64 KiB，无 browser facts，仅 20 个 organization members | 319.522 ms | **65,536** | `partial` | 43 | 1 | 不适用 |

完整 browser facts 场景虽然输入报告有 500 个 visible refs、500 个 geometry，最终 context 在最小预算收缩阶段清空了 `viewFacts.visibleRefs`、`viewFacts.measured` 和 browser facts 的 visible/geometry；结果中的 browser facts 仍只留下 `status: "current"` 等 envelope 字段。这里的 `current` 只表示 context 按传入的 status/revision 字段把 report 解释为 current；build、epoch、capture freshness 的正式校验属于 server ingest path，本次纯 context benchmark 没有替代该校验，也不能逆推当前页面仍然保留 500 个可见对象。

“仅 20 个 organization members”场景现在被压到 `65,536 bytes`，状态为 `partial`，保留 43 个节点、1 个 organization cluster，并保留 `node:rep-43:byte-budget` 的 omission reason。修复后的 `buildExpressionContext()` 在刷新状态 envelope 后再次执行最终 `trimToBudget()`，因此 `refreshContextStatus()` 追加的 omission IDs、missing/layers 和 reasons 不会把结果重新推过字节上限。500-node regression 位于 `tests/expression-harness.test.ts`：窄 target 保持 20 个节点可用，20-member organization 保留 budget omission evidence，完整 500-node graph 明确返回 `insufficient_context` 且不越 64 KiB。

这个结果不应被解释为 benchmark runner 失效：`buildExpressionContext()` 的实现明确声明只读 snapshot/view，并在 `MIN_CONTEXT_BYTES=2048` 下用 `insufficient_context` envelope 表达丢失（`src/expression/context.ts:60-89,1540-1548,1330-1444`）。应把 context 的 `status`、`omissions`、`missing` 和 `needsClarification` 一起作为下游判断条件；在这些字段表示结构已经清空时，不能只依据调用无异常或 browser facts 的原始 status 宣称页面可见。

## 组织 view / plan 的纯模块规模结果

同一 500-node fixture 上，`projectOrganizationView(snapshot, "g", { scope: "all", density: "complete", intent: "monitor" })` 的 7 次中位数为 **8.774 ms**，返回 500 visible refs、1 group、500 task summaries；`planOrganizationView(...)` 的 7 次中位数为 **6.511 ms**，返回 500 visible refs、500 tasks、500 task summaries。两者的 task `sourceKind` 都只有 `entity`；样例 `e-0` 的 source 为 `source://task/0`，`executionObserved=false`。

这与实现边界一致：`planOrganizationView` 被定义为 presentation-only、不会修改 snapshot、entity/run state 或创建 relation（`src/layout/organization.ts:794-798`），并在 all scope 下使用全部 graph refs、再从 entity 生成 task summaries（`src/layout/organization.ts:809-840,892-911`）。组织 view 返回稳定 `revision`、visible/hidden refs、tasks 和 source（`src/layout/organization-view.ts:441-482`），但 entity source 不是 run receipt；`doing` 或 `source://task/i` 不能证明真实执行。

## 30 annotations 的 organization observations

30 个 annotation 均调用 `buildOrganizationObservations(annotation, snapshot, snapshot)`。5 次执行中位数为 **12.806 ms**，输出包含 30 个 annotation observations；每个 observation 有 1 个 organization cluster、500 个 selected refs，所有 observation 序列化后的总大小为 **1,231,861 bytes**。snapshot revision 保持 `7 → 7`，`sourceUnchanged=true`。

该路径只做冻结选择的观察投影：`freezeOrganizationSelection()` 保存 cluster/ref scope，`buildOrganizationObservations()` 同时读取 observed/current snapshot 并生成当前 diff（`src/core/organization-feedback.ts:15-53`）。现有反馈测试只构造一个 annotation，验证 regrouping、deletion、restart 后的历史 selection、diff、geometry 和持久化（`tests/organization-feedback.test.ts:12-47`），以及一个显式 ref 不扩大为 whole group（`tests/organization-feedback.test.ts:49-53`）。当前没有 annotation observation 的独立 maxBytes/maxItems 预算；1.23 MB 是本 benchmark 的实测规模提示，不是现有协议承诺的限制。

## display facts 与现有 harness 的覆盖边界

display facts server path 在 `src/server/index.ts:1196-1224` 校验 project/workCopy identity、UI build、source revision、graph existence、capture freshness、viewEpoch 单调性和 refs 是否属于 graph；成功接收只写入 server 的 bounded browser report，并返回 `contentRevisionChanged: false`。`/api/display-facts` 还要求 write token（`src/server/index.ts:2493-2497`）。表达式检查在 browser facts 非 current 时发出 `DISPLAY_FACTS_UNAVAILABLE`，current 但未 measured 时发出 `DISPLAY_FACTS_UNMEASURED`（`src/expression/checks.ts:158-160`）。

对应测试 `tests/server-display-facts.test.ts:12-30` 已覆盖：

- missing → current → source revision 变化后的 stale；
- 重复 epoch 的 `STALE_VIEW`；
- build mismatch；
- 无效 geometry ref；
- 未授权/授权 HTTP POST；
- display report 接收不改变 source revision。

但该测试使用空 geometry、空 visible refs 的单个 report，没有 500 geometry/visible refs 的正式 server regression。benchmark 的 500-display-facts 输入只是传给 `buildExpressionContext` 的纯对象，不能替代 browser、server 或实际 DOM 采集证据。

expression harness 的基础 snapshot 只有 2 entities、2 representations、1 relation、1 free text element，fixture 在 `tests/expression-harness.test.ts:10-106`；测试已有 30 KiB bounded context、organization cluster/link projection、局部 target、2,400/2,048 bytes omission checks，以及 500-node expression context 的窄 target、20-member organization 和 full-graph regression（`tests/expression-harness.test.ts:109-127,166-203,240-292,300-341`）。server 端仍没有 500-geometry/visible refs 压力样本，annotation observation 也没有独立批量压力测试。

organization tests 使用 5 个实体、6 个 representations 和少量 relation/branch（`tests/organization.test.ts:9-66`），覆盖 metadata fallback、scope/density、cross-cluster portal、source snapshot unchanged、entity status 与 monitor attention（`tests/organization.test.ts:82-236`）。organization-view tests 使用 4 个实体、4 个 representations，覆盖 hierarchy expansion、layout owner/bounds、source unchanged、cycle 和 missing anchor diagnostics（`tests/organization-view.test.ts:6-47,50-103`）。这些测试验证语义和不写回边界，但不是规模门槛。

## 审计判断与后续可验证项

1. **当前可确认：** 500 placement 的纯组织规划/投影不会修改 source snapshot；entity source 与 `executionObserved=false` 保持证据边界；30 个 frozen organization observations 不改变 revision。
2. **当前不可确认：** browser 实际是否能在页面上显示 500 个对象、DOM 测量是否在合理时间完成、server 是否能稳定接收 500 geometry、用户是否能阅读 1.23 MB 的 annotation observation。
3. **仍需回归保护：** 为大 organization omissions 保持最终 `JSON.stringify` bytes assertion；为批量 annotations 明确 maxBytes/maxItems 或分页策略，并为 server 端增加 500 geometry/visible refs 的接收回归。
4. **表达边界：** `current` display facts 只证明 report 通过当前 build/revision/epoch/freshness 校验；organization view/plan 只证明纯数据投影；三者都不能独立证明 browser V1 的 DOM/UI 性能或产品 E2E。

本报告不构成 browser V1 性能门槛，也没有启动或修改 live。此前候选 `R160` 来自隔离 `127.0.0.1:58473`、workCopy `861853ec...`，不应与 live `R158` / workCopy `bdc90254...` 混用；若 root 需要 live 结论，应基于 live R158 重新读取并重跑，不能用本合成 fixture 代替。

## 验证命令与结果

定向测试命令：

```sh
cd /Users/Zhuanz1/Desktop/file/AutoResearch/plugins/agent-visual-canvas
./node_modules/.bin/vitest run \
  tests/expression-harness.test.ts \
  tests/server-display-facts.test.ts \
  tests/organization.test.ts \
  tests/organization-view.test.ts \
  tests/organization-feedback.test.ts
```

结果：5 个 test files、31 个 tests 全部通过；耗时约 624 ms。该验证只覆盖上述纯函数与既有 server test 的本地 harness 生命周期，不代表 browser UI、live service、DOM 或远程宿主验收。
