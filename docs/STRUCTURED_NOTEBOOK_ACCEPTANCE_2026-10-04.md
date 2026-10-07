# 结构化空间笔记改造验收

日期：2026-10-04。状态：本轮源码、隔离页面、r21 安装及正式页面补修验收通过；正式图已升级至 R159。当前 MCP 未重载，完整 V1 继续分项验收。

## 保护与验收对象

- 原项目 `cb904f16-a9ec-4a38-831c-d84d9a08df80`，原工作副本 `bdc90254-57fe-4968-97a4-96473ca9868f`；升级前重新读取的基线为 R158，实际应用后为 R159。最终查看、缩放及控件开关后重新读取仍为 R159。
- 完整资源及历史备份：`.runtime/structured-retrofit-20261004/live-r158.avcanvas`，2,907,299 bytes，SHA-256 `9701f833ff15f2353c38b7a6eb65f2403f73b6929cc9cdf0aea250f1c3f88ad8`。
- 隔离工作副本 `861853ec-6305-4877-9427-017a130c2184`，独立入口 `http://127.0.0.1:58473/`。论文局部使用 `acceptance-fr-nested`，真实任务使用 `acceptance-live-tasks`。
- 论文原始身份、定量结论、自由文本、SVG、批注、历史、native group / Frame / sceneOrder 均保留。论文升级候选仅修改组织 metadata。

## 已发现并保留的失败

1. 首版页面首次缩至 10%，分组聚焦为 34%，不能作为可读性通过证据。
2. 第二轮发现 `scope=all` 与独立展开状态不一致，收起子组仍显示。
3. 第二轮换图测量集合因旧 scope 被拒绝，维护结果未生效；F/R 正文实际高度超出估计高度，与示例覆盖。
4. 分组边界曾直接取 source 几何，未消费统一维护的递归 bounds。
5. 上一轮统一检查记录的 `271` 项结果属于上一轮结果；本轮最终统一检查为 36 文件 / 276 项通过，旧数字不作为最终结果。

以上失败保留为失败记录，旧截图仅作失败证据。下面的纯模块结果不能替代真实页面、安装或宿主验收；验收过程中的纯查看没有产生内容修订。

## 纯模块验收（本轮补充）

- **64 KiB expression context 修复：** [structured retrofit harness 证据](evidence/structured-retrofit-harness-20261004.md)记录了最终 trim 在 `refreshContextStatus()` 之后再次执行。20-member organization 场景最终为 `65,536 bytes`、`partial`，完整 500-node graph 明确返回 `insufficient_context` 且不越 64 KiB；结果来自纯模块 fixture，不证明页面已显示。
- **500 geometry：** [notebook-maintainer 500-geometry 证据](evidence/notebook-maintainer-500-geometry-20261004.json)记录 500 个 visible geometry、15 次纯 `maintainNotebook` 调用，median `10.601 ms`、p95 `12.451 ms`，pinned displacement `0`、visible collision `0`、输出可应用。该基准不包含 DOM 测量、浏览器渲染或 live 写入。
- **annotation observation 巨量边界：** [annotation observation 字节预算证据](evidence/annotation-observation-budget-20261004.md)记录 30 条 annotation、**每条选中 500 refs** 的极端 fixture，总 observation 约 `1,231,801 bytes`，单条约 `41.1 KiB`；64 KiB 只能每页放 1 条，30 KiB 连单条完整 observation 都放不下。该 fixture 用来暴露预算边界，不代表本轮常用的几条目标 annotation；当前函数也没有已承诺的 ref 级分页协议。

## 真实任务证据

备份校验通过实际本机 Node 子进程运行：pid7817，开始 `2026-10-03T18:27:15.467Z`，完成 `2026-10-03T18:27:15.621Z`，退出码 0，字节数与 SHA-256 匹配上述备份。原始回执保存在 `.runtime/structured-retrofit-20261004/task-execution-result.json`。

运行状态与回执进入隔离项目历史，完成后的正文及状态已同步。此进程很短，未捕获页面实时运行中的截图；不能声称已证明长任务监控体验。Windows 实机任务标为 blocked，读者复述标为 todo，不以显示样例冒充执行。

## 最终结果

本轮交付为结构化空间笔记的可用增量，通过以下范围；不宣称全部 P0–P5 或完整 V1 已通过。

| 层次 | 实际结果 |
| --- | --- |
| 源码/构建 | 类型检查通过；36 文件 276 测试通过；production build 通过；Excalidraw subset worker/font assets 已打包 |
| 多级结构 | F/R 同时展开，y=1100 保持并列；示例 y=1564；第三层 subcategory 独立显现/隐藏；递归边界包含子卡和原生 SVG |
| 正文细则 | 实际测量 F 392→764→392；标题处的收起按钮在可见区域；选择标题不打开弹窗或自动展开正文 |
| 局部避让 | 旧论文 F/R 的 source 卡片间距32，但新分组边界侵入邻居；已改按真实 source content 判定历史重叠，标题/留白参与当前避让，最终纸图 diagnostics=[] |
| 自由编辑 | 隔离框实际保存多行正文/标题 R176，拖动 R177，尺寸缩为455×238 R178，长文 R179，删除 R180 / 撤销 R181；后续新增文本在收起分组中立即打开并显示 R182 |
| 预览 | 未选中框正文滚动0→518.5→0；滚动时相机不变；fixed body clientHeight164 / scrollHeight683；编辑结束按钮已移至顶部并实际点击关闭 |
| 画布/窗口 | 抓手拖动经过卡片不被悬停拦截；顶部/右栏独立收放；1440×900与626×692检查，窄窗隐藏后画布占满626×692 |
| 图文共面 | 升级候选已在隔离R166应用，真实论文正文、SVG、概念卡同一平面；源码几何和原内容未迁移改写 |
| 批注 | 两条分别观察R166/R167、独立F/R目标；R170接收、R171–174逐条认领/响应；冻结观察哈希一致 |
| 任务 | 实际Node退出码0与备份hash有原始回执；页面显示任务来源和执行观察；未声称已捕获长任务运行中的UI |

最终发行 buildId 为 `structured-notebook-20261004-r21-final`，隔离工作副本 `861853ec-6305-4877-9427-017a130c2184`。最后隔离项目 R184；核心几何与交互报告来自 r20，不把它们改写成 r21 显示回执。不同图的显示报告分别为 current/stale/missing，换图不伪造未显示的当前测量。

本轮页面原始证据位于 `.runtime/structured-retrofit-20261004/`：`fr-final-wide.jpg`、`fr-expanded-final-display.json`、`paper-organization-final.jpg`、`paper-display-final.json`、`narrow-toggle-final.jpg`、`independent-feedback-result.json`。旧失败截图仍保留。本机安装/live迁移结果由 root 在[部署说明](LOCAL_DEPLOYMENT.md)追加；发行包内文档是发布时快照。

正式项目已实际应用组织 metadata：R158→R159，change `a7d44a05-745a-4ece-8eb5-a4ef87e92d0c`。差异核对确认 entities/relations/representations/freeElements/resources/annotations/batches/runs 等内容一致，其他图及目标图非组织 metadata 一致。原 MCP 进程继续持有数据目录。

r21 正式安装已通过 ZIP/sidecar/931 文件清单复核，安装程序的真实 stdio 检查 30 项通过。正式页面刷新已实际取得 r21 资源；626×692 默认窗口、44% 缩放下，绘图工具收起时 `App-bottom-bar` 为 hidden，空底条不再遮住正文；打开绘图工具后该条为 visible，选择、矩形、箭头、文字、图片等原生控件实际出现。最后恢复阅读状态并保留正式页面。

r21 配套证据为 [正式页面截图](../.runtime/structured-retrofit-20261004/live-r21-narrow.jpg)、[同镜头 DOM 记录](../.runtime/structured-retrofit-20261004/live-r21-ui-proof.json)及[绘图工具展开记录](../.runtime/structured-retrofit-20261004/live-r21-drawing-open.txt)。这是页面观察，不冒充旧服务不支持的 display_facts 回执。早先 `paper-display-final.json` 的 viewport 1440×664 / zoom 1.35 与 `paper-organization-final.jpg` 的1440×900 / 69% 属于不同镜头，不能作为同一 view epoch 的配套记录。

当前 PID22479 仍为旧 MCP 进程；新程序可启动的安装检查与当前 Codex 已重载是两个事实。下次完整重启后，需实际调用新服务核对版本、身份和入口。完整部署及回退依据见[部署说明](LOCAL_DEPLOYMENT.md)。

分组整体拖动及宽度控制尚未实现；全部 native 旋转/Frame/绘制顺序组合、IME 与 Agent 并发草稿未完成本轮实际验收。极端批注的 ref 级分片仍未实现。

原生 Windows / Claude Code 实机、真人初读理解与完整浏览器性能门槛保持独立待验。
