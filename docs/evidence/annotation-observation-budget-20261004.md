# Annotation observation 字节预算只读基准（2026-10-04）

## 结论

当前 `buildOrganizationObservations()` 会把 frozen organization selection 原样放进每条 observation。500 个 representation、每条 annotation 选中 500 个 refs 的 fixture 中，30 条 observation 合计 **1,231,801 bytes**；单条带 annotation envelope 的 item 为 **41,108–41,109 bytes**。

这意味着：

- 64 KiB 页面预算只能放 1 条 observation，需要 30 页才能容纳 30 条；
- 30 KiB 页面预算连 1 条完整 observation 都放不下，当前函数没有 ref 级拆分或分页协议；
- 128 KiB 可放 3 条/页，共 10 页；256 KiB 可放 6 条/页，共 5 页。

因此，批量 observation 不能直接作为 30 KiB expression/context envelope 的一个整体返回。若产品要支持 30 KiB 级别的上下文，需要先定义 observation 的 ref/cluster 分页协议，不能只按 annotation 条数切页。

## 运行方式

入口为 `scripts/annotation-observation-budget.ts`，通过本地 esbuild bundle 执行：

```sh
cd /Users/Zhuanz1/Desktop/file/AutoResearch/plugins/agent-visual-canvas
./node_modules/.bin/esbuild scripts/annotation-observation-budget.ts \
  --bundle --platform=node --format=esm \
  --outfile=/tmp/annotation-observation-budget.mjs
node /tmp/annotation-observation-budget.mjs
```

fixture 与 `structured-retrofit-bench.ts` 对齐：500 个 task entity、500 个 representation、1 个包含 500 refs 的 organization cluster、30 个 annotation；每条 annotation 绑定同一个 frozen cluster selection，`selectedRefs=500`、`visibleRefs=1`、`observedRevision=7`。

脚本只调用 `freezeOrganizationSelection()` 和 `buildOrganizationObservations()`，并在内存中按 JSON UTF-8 bytes 做页面装箱估算；不启动 server、不发送 HTTP、不写 annotation、不修改 revision，也不声称实现了分页协议。

## 实测结果

5 次构建中位数为 **14.226 ms**，得到 30 条 observation；snapshot revision 保持 `7 → 7`。

| 页面预算 | 页数 | 每页 observation | 超限 item | 最大页字节 |
| ---: | ---: | ---: | ---: | ---: |
| 30,000 bytes | 30 | 1 | 30/30，单 item 约 41.1 KiB | 41,111 |
| 65,536 bytes | 30 | 1 | 0/30 | 41,111 |
| 131,072 bytes | 10 | 3 | 0/30 | 123,331 |
| 262,144 bytes | 5 | 6 | 0/30 | 246,661 |

30 KiB 场景的“页”仍然保留了单个超限 item，只用于明确显示现有 observation 粒度无法满足该预算；它不是一个可交付的协议实现。

## 证据边界与后续决策

当前 observation 数据包含 frozen cluster、selected refs、visible refs、ancestor paths 和 current diff。现有函数没有 `maxBytes`、`maxItems`、cursor 或 continuation token，也没有把一个 observation 拆成多个可合并片段的契约。

因此目前能确认的是序列化规模和分页压力，不能确认页面能否消费这些数据，也不能把按 annotation 数量的装箱结果当成 server/API/UI 已支持的分页。若要修复，应先由协议 owner 决定是按 annotation 分页，还是按 selected refs/cluster fragments 分页，再补 schema、重组和恢复测试。
