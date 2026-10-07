# V1 正确性与交付验收矩阵

当前本机更新至 r10/p1.3：类型检查、179项源码、31项真实UI及18项r10正式stdio检查通过；栏位、缩放及平面阅读见[专项验收](WORKSPACE_CONTROLS_ACCEPTANCE_2026-10-03.md)。p1.2 的正式安装 Node 24 stdio 的18项表达/重开/迁移检查及实际页面记录保留。当前 Codex 已真实更新论文表达、读取冻结上下文、逐条修改并独立回应三条锚定批注；详见[表达增量验收](EXPRESSION_ACCEPTANCE_2026-10-03.md)。原元控件操作链与其他历史证据保留。

日期：2026-10-03。实施基线：[p1.3 完整计划](../../../research/excalidraw_plugin_v1_implementation_plan.md)。本表保留完整 V1 的18个场景；D013–D017 的本机增量由上述专项验收覆盖，过程见[实施记录](IMPLEMENTATION_STATUS.md)。

**当前结论：p1.2 表达及 p1.3 工作区交互本机分项通过，完整 V1 尚未验收。** Windows、Claude 专用通道、Codex 原生标注、跨平台往返、原生层级和最终性能继续待验；源码、安装 stdio、实际页面和宿主层的证据分别记录，旧失败保留。

“部分”表示列明的子项已有证据，整项还有要求未证实。“待验”表示缺少对应实际运行证据。源码、单元检查、生产服务、浏览器和宿主各层证据不能互相替代。

| 场景 | 当前状态 | 已有证据与剩余验收 |
| --- | --- | --- |
| 1. 多图状态及父项计数 | 本机交互分项通过 | [r11 多图与摘要补验](evidence/multigraph-parent-summary-resumed-macos-r11.json)：A / B 实际状态像素一致，重复表示不重复计数，取消单列，失败 / 阻塞并列；父项自身 doing 状态保持。 |
| 2. Agent 更新保护用户视图和草稿 | 本机交互分项通过；性能另验 | [r22 跟随 28 项](evidence/follow-agent-macos-r22.json)、[新增目标立即 focus 6 项](evidence/fresh-target-focus-macos-r22.json)及[手动覆盖导航 7 项](evidence/follow-manual-override-macos-r22.json)通过：默认关闭、提示 / 查看、自动跨图、返回相机、禁用跟随、真实新目标在原缩放下可见；原草稿、目标、观察版本和路径保持，presentation 不写内容。公开浏览器帧门只用于验证用户覆盖待执行导航，不证明性能。 |
| 3. 拆分、关系、文字、复制和删除身份 | 部分；混合复制复验通过，Frame / 层级待验 | 既有 [r16 原生复制](evidence/native-copy-macos-r16.json)基本身份通过；r22 [受管组重载 / 解除 / 撤销 8 项](evidence/native-managed-group-reload-undo-macos-r22.json)通过。r23 [实际回声循环](evidence/native-mixed-echo-loop-macos-r23.json) R75 → R303 失败保持。新身份限定修复经根代理 136 项全量检查及[本机安装页面 16 项](evidence/native-mixed-copy-installed-r1.json)通过：真实混合复制只一条修订，绘制顺序完整，重载及延迟窗口零写入，解除复制组保持原组。Frame、跨类型排序及全部相关 UI 回归继续待验。 |
| 4. 旧基线合并、冲突和撤销 | 本机交互分项通过 | [真实受保护撤销](evidence/protected-undo-real-macos-r6.json)、[r20 最小冲突](evidence/interleaved-edit-macos-r20minimal.json)及[完整交错 / 主动重写](evidence/interleaved-edit-macos-r20.json)通过。不同字段 R58 → R60 合并；同字段 R60 → Agent R61 后旧请求 HTTP409，实际 native editor 显示 R61 标题，两组三秒无新修订。用户主动重写 R61 → R62 只留一条 title 修改，再三秒稳定。几何 / 自由元素 / 批注 / Agent 更新期相机保持，34 项断言通过。原 r16–r19 失败保留；[实际时序根因](evidence/interleaved-edit-root-cause-macos-r20.json)证明旧 queued projection frame 在拒绝清理后重放 pending，已改为 frame 执行时读取当前有效 scene。 |
| 5. 提交后丢失回执及重试 | 本机服务通过 | [r9 真实发行服务故障补验](evidence/postcommit-crash-release-macos-r9.json)：上游已提交、客户端零响应后断开，重试只留一条历史；提交前断开亦可恢复。 |
| 6. 跨图、跨观察版本及删除目标 | 本机交互分项通过 | [跨图独立批注](evidence/batch-real-macos-r1.json)、30 条历史上下文及[r11 观察版本查看](evidence/composer-observed-history-macos-r11.json)通过；[r14 删除目标](evidence/deleted-targets-ui-corrected-macos-r14.json)实际点击三条批注的观察版本入口，恢复原 R28 实体 / 自由椭圆 / 连线视图，返回保留批注、实时内容 R30 不变。历史概览不绘制连线文字，原文可从同版本结构化读取。 |
| 7. 30 条分页、独立结果及处理恢复 | 本机提取发行服务通过 | [r4 提取包实际结果](evidence/batch30-stdio-release-macos-r4.json)：37 项断言、全部 30 条独立结果、中途 EOF 重启、冻结 hash 不变、同 ID 重试和异内容拒绝通过；最后 5 条仅由清单关联。28 条响应、1 条澄清、1 条失败，独立结果关联实际内容修改。r9 失败保留。 |
| 8. 讨论、追问、来源及迁移后查看 | 本机交互分项通过 | [真实讨论链](evidence/discussion-real-macos-r1.json)、[r14 范围过滤](evidence/discussion-scope-macos-r14.json)及[导入副本实际查看](evidence/discussion-import-view-macos-r14.json)通过：项目讨论跨图可见，图 / 批注讨论限定所在图；独立副本内原文、目标和记录精确保持，查看 R30 → R30。跨原生 Windows 另验。 |
| 9. 子图多入口、深层返回与回路 | 本机交互分项通过 | [五层实际导航](evidence/deep-navigation-real-macos-r2.json)、[十次相机恢复](evidence/camera-roundtrip-real-macos-r2.json)及[r10多入口回路](evidence/navigation-composer-real-macos-r10.json)的六个导航断言通过；该报告后续输入恢复失败不影响已完成的导航证据，仍需随稳定发行核对。 |
| 10. 高亮随视图和对象变化 | 本机交互分项通过 | [r12 真实高亮](evidence/highlight-real-macos-r12.json)验证图范围、平移 / 缩放、自由元素 / 连线及 TTL；[r14 对象移动](evidence/highlight-move-resumed-macos-r14.json)实测原位置 0 个高亮像素，新位置 2,653 个，内容仅有主动位置变更 R22 → R23，五秒稳定，TTL 不写历史。 |
| 11. Codex 原生标注与准确交接 | 当前 Codex 通用路径通过；原生标注未接入 | 当前对话已真实读取冻结上下文、回写内容及逐条回应；[本轮富文本/分节批次](evidence/rich-feedback-context-r6.json)与[页面独立回应](evidence/rich-feedback-responses-ui-r6.json)通过。本机保存 R67、实际宿主接收 R68、独立回应 R70/R72 分别可查。服务仍明确报告原生标注不可用。 |
| 12. Claude 通道与通用交接 | 待宿主验收 | manifest 校验、通用 stdio、配置文件解析通过；实际既有对话加载 / 交接未验，channels 明确未接入。 |
| 13. 运行范围和真实控制回执 | 部分 | [r4 真实已登记子进程停止](evidence/execution-release-node24-macos-r4.json)通过，包含真实退出及 verified effective 回执；不证明现有宿主整轮中断、继续或重试。 |
| 14. 项目包校验与双向迁移 | 部分 | [同机真实迁移](evidence/package-ui-free-assets-macos-r3.json)、preflight 检查和[r11 损坏包正式 UI](evidence/corrupt-package-ui-macos-r11.json)通过：明确显示资源 SHA-256 校验失败，原项目完全不变且可重试。Mac → 原生 Windows → Mac 待验。 |
| 15. 导入 / 恢复不重发执行、区分副本 | 部分 | 同机来源保留、新副本写入及[历史恢复](evidence/history-real-macos-r1.json)通过；跨平台及真实宿主 / 执行器核实待验。 |
| 16. 离线中文、长标题、图片与预览 | 本机交互分项通过；新发行待核对 | [r12 离线冷打开](evidence/offline-browser-macos-r12.json)、[实际 SVG](evidence/offline-preview-worker-macos-r12.json)、[PNG 补验](evidence/offline-preview-worker-resumed-macos-r12.json)及[r13 Worker](evidence/offline-browser-worker-macos-r13.json)通过；[r14b 强制外网拒绝](evidence/offline-policy-macos-r14b.json)核对首页逐字节一致，外部 fetch 被拒绝，230 次 SDK 外部字体尝试传输 / 响应为零，实际本地字体和画布可用、重载无修订。测试 CSP 为 SDK Emscripten Worker 允许内部 eval。 |
| 17. 中文 / 空格和 Windows 路径发行入口 | 部分 | [r4 提取包 Node 24.21.0 启动](evidence/execution-release-node24-macos-r4.json)、纯 stdio / EOF 及[配置解析](evidence/config-release-macos-r4.json)通过；原生 Windows 待验。 |
| 18. 单写服务、释放和崩溃恢复 | 本机服务通过 | [r9 隔离真实故障补验](evidence/postcommit-crash-release-macos-r9.json)：第二写者拒绝、实际 SIGKILL、归档旧占用、精确恢复、重试去重和正常关闭通过。Windows 语义另验。 |

## 性能和外部验收

- 固定项目和预算继续采用计划第 14 节，不降低门槛。既有三个服务空闲窗口和核心规模报告按其实际版本使用；可见刷新、手势、热切图及浏览器增量内存仍不能标为通过。
- [r11 固定规模上下文](evidence/context-performance-macos-r11.json)：Node 24 生产 stdio、500 对象 / 20 图 / 1,000 表示 / 10,000 历史 / 30 条跨图批注；三次完整读取 p95 161.685 ms，完整条目与冻结字节保持。此项验证读取预算，不替代图像生成或可见更新性能。
- [r9 刷新环境检查](evidence/browser-frame-boundary-macos-r9.json)：页面可见、聚焦，公开生命周期设为 active 后，空闲 rAF 仍约 1,000 ms。此检查没有施加新负载；该环境数字不足以认定产品性能，暂不重跑沉重探针。
- 原生 Windows 仍缺实际机器验收。r9 对近期 `pc-amd-nvd` 线索只读检查不可达，未发起 SSH 或部署；没有以 WSL 代替。
- 真实宿主验收继续复用既有对话。生成配置、通用 MCP 客户端和登记测试执行器不算既有 Codex / Claude 模型交接，未改用户配置。

## 修订

| 修订 | 内容 |
| --- | --- |
| r9 | 对全部 18 项建立证据映射；新增真实传输 / 崩溃补验；保留 30 条反馈的冻结失败；据此开启最小修复与下一候选验收。 |
| r13 | 更新输入恢复 / 观察版本、共享状态 / 父项摘要、损坏包具体提示、真实高亮、离线画布 / 预览 / Worker 和上下文读取证据；保留原生复制的延迟修订失败，完整 V1 状态保持未验收。 |
| r16 | 原生复制稳定性 16 项通过；补入删除目标历史、移动后高亮、讨论范围、导入副本查看和强制外网拒绝证据；110 项自动检查通过，准备 r3 提取包验收，原有失败与外部待验项保留。 |
| r3 发行提取验收 | 672 个归档条目、671 个内容哈希匹配；p1.0 / r1.2 便携快照与链接校验通过；Node 24 正式入口 30 项、30 条反馈恢复 37 项、配置解析 9 项通过。源记录和旁置验收单包含提取后结果，已校验 ZIP 保持不变。 |
| r16 页面交错补验 | 原生 UI 的实际旧基线请求经历不同 / 同字段 Agent 更新，合并与明确冲突 22 项通过；后续原生编辑框验证发现画布仍用旧标题，保留失败并开启场景恢复修复。首个探针因初次 fit 与像素时序选到空白处失败，续验以实际填充像素定位。 |
| r18c 实际冲突补验 | r18 112 项自动检查通过；[修正探针](evidence/interleaved-edit-macos-r18c.json)的不同字段标题 / 状态、几何、批注、自由元素、相机及稳定通过，同字段 HTTP409 后仍出现新基线自动重提 R50 → R51，原生标题恢复与零延迟提交失败。r18 / r18b 的相机基线和缓存坐标测量问题另行保留，不作为真实同字段失败的解释。 |
| r19 待提交身份补验 | 113 项检查通过；[真实探针](evidence/interleaved-edit-macos-r19.json)的不同字段 R51 → R53 全部通过，同字段 HTTP409 后约 1.5 秒出现 base54 自动重提 R54 → R55，三个稳定 / 显示断言仍失败。继续诊断实际拒绝和异步场景投影顺序，r4 尚未生成。 |
| r20 冲突稳定修复 | [最小诊断](evidence/interleaved-edit-macos-r20diag.json)证明 409 清理已成功，旧 frame 重放 captured pending4 才产生 phantom。改为执行时读取当前 projection / pending，114 项检查、14 项最小真实链路及34项双案例 / 主动重写通过；临时诊断已移除，生成 r4 并提取验收。 |
| r4 发行提取验收 | 694 个归档条目、693 个内容 hash 精确匹配；p1.0 / r1.2 便携文档、许可和链接 11 项，Node 24 / 正式入口 30 项，30 条反馈恢复 37 项，配置解析 9 项全部通过。370 个源 / 提取 / 清单生产文件一致，ZIP SHA保持；打包后结果见源证据及包旁验收单。 |
