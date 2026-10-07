# Agent 作图与图上协作：实施与验收

日期：2026-10-07。范围：本地 Agent Visual Canvas。正式项目起点 R189，验收结果 R200；本轮只增加独立验收图与意见回执。原有 142 个对象、233 条关系、33 张图、216 个表示、71 个自由元素及 10 个资源经全字段对比均保留。

## 产品闭环

用户选择节点、连线或一片区域，直接写要求。每处意见独立保存，多个位置统一形成批次。Agent 读取每条原话、稳定目标、观察版本与必要上下文，逐条回应；修改时记录实际 changeId 与 revision。普通局部工作沿既有授权完成，主线、归属和固定几何的大调整先提供可审阅候选。

内容策划采用同一二维图文笔记：先确定读者正在回答的问题，再组织连续主干、必要背景、原子支线、局部机制图解和证据。小簇内自洽，跨簇以入口/出口和必要回顾承接。understand、monitor、mixed 决定注意优先级，思维导图、流程和自由文字仍可共存。

## 本轮实施

| 工作 | 落地入口 | 验收方式 |
|---|---|---|
| 主动作图入口 | installed skill → bounded expression_recipe / expression_prompt | 独立安装 stdio 实际读取 schema 与 recipe |
| 策划工作说明 | read → plan → preflight → apply → display | 隔离项目局部事务实际产生 R1→R2 与 changeId |
| 有界增量 | editable targets、read-only 一跳背景、dirtyScope、omissions | 邻域只读、范围扩张声明、未知字段和 pins 回归 |
| prompt 引用边界 | 导入主线与簇文字仅进入 quoted JSON | 恶意目标/主线/簇名称和换行 ID 回归 |
| 就地请求 | 选区工具栏「让 Agent 处理」→ 轻量 composer | 单选、多选、真实框选、420×760 窄窗口 |
| 独立意见与批次 | 冻结 annotation + 原子 batch | 两条意见分别观察 R190/R191，在 R192 提交 |
| 接收与回执 | 当前 Agent 实际 handoff → claim → respond | 两条意见分别产生回应，批次最终 responded |
| 草稿与重试 | scoped session/storage drafts、同 operation ID pending queue | 关闭恢复、丢 ACK、storage denial、work-copy 切换与 replay |
| 实际运行投影 | latest run + verified + executor + fresh timestamp | 真 Node 心跳 PID 与 124 次观察；运行、过期、完成态 |
| 低负载动效 | CSS 脉冲 + 10 秒本地过期时钟 | 隐藏页面停钟，reduced-motion 静态显示；不写内容版本 |

安装 smoke 的 run/executor 是明确标记的隔离 fixture；浏览器动效验收使用另一个实际 Node 进程，二者不是同一证据。该进程在 2026-10-06T17:50:25Z 实际结束，已确认退出，随后才写 completed 与 executor disconnected。没有留下永久假 running。

运行观察从 R198 更新到 R199 时，四块内容的屏幕坐标、尺寸及 70% 缩放保持；浏览、选择、框选、草稿输入和动效本身不增加项目修订。新增执行状态徽标独立占一行，未挤占标题。

## 引导 Agent 的使用顺序

1. canvas_open 核对项目、工作副本、修订与当前能力。
2. 精读用户目标；expression_recipe 选 understand/monitor/mixed，邻域只读，缺材料按 omissions 补读。不要每轮将整个项目放入上下文。
3. 写明读者问题、主干、原子支线、图解责任和来源；复用稳定身份、术语和原组织。在远距复用概念的位置就地回顾。
4. 生成局部 operations，expression_validate 检查范围、组织、动作和固定几何；内容更新与需要布局的变化分别处理。
5. canvas_apply 使用读基线、稳定 operationId、actor、reason；丢响应重试同一请求，同字段冲突重读并合并双方意图。
6. 读取受影响对象及 display_facts，核对实际显示并向每条 annotation 记录结果。内容保存、显示验收和实际执行分别报告。

插件不另开模型服务。已安装技能是入口，recipe 与 prompt 由当前 Agent 按需读取。MCP 返回工作说明不等于自动注入宿主系统提示；canvas_apply 也没有强制 expression_validate 的策略门。

## 后续顺序与通过条件

| 优先级 | 计划 | 通过条件 |
|---|---|---|
| P1 | 将意见列表默认缩到当前图/批次，并支持原位回执定位 | 不必翻全项目历史即可看到自己的请求及每条回应 |
| P1 | 检测 Codex/Claude 可用收件桥；提供真实宿主 ACK | 保存、发送、接收、领取状态可逐层核对；没有桥仍用短引用 |
| P2 | 统一语义候选与投影后协同预检 | 多步组织修改在完整候选上验证，不依靠逐项基线检查 |
| P2 | 从变更字段与实际测量派生 dirty scope，接 MCP 笔记布局候选 | 正文变高只维护本簇；固定位置和阅读锚点保留；旧测量被拒绝 |
| P2 | 带执行来源协议的 heartbeat adapters | 真进程/任务观察驱动更新，浏览器时钟不冒充 executor heartbeat |
| P3 | 显示回报补屏幕相交、裁切与资源加载，以及读者理解验收 | 分开证明已渲染、在视口内、未遮挡和读者能复述 |
| P3 | 按条候选差异审阅、可撤销临时预览 | 绑定观察版本，正式修改与临时呈现分开，保持既有授权 |

以上是后续实施队列，不宣称本轮已实现。当前只复制短引用到既有 Agent 会话；自动宿主收件桥尚未接通。

## 部署与证据

最终发行 build 为 agent-harness-20261007-r29.3。发行校验、安装 stdio smoke 与浏览器验收记录保存在 `.runtime/agent-harness-20261007/`，分别含 manifest/checksum、工具 schema、局部事务回执、截图及 `ui-acceptance.json`。最终测试数字与当前发行结果见同目录记录。

当前 Codex 持有 r21 MCP writer，保留其运行与项目锁；页面资源可独立加载新版本。完整 expression_recipe/action 契约在下次宿主重启加载。由于 writer/UI build 不同，当前 writer 的 display_facts 不能被视为新版 current 显示验收；浏览器截图和实际交互另行记录。新版独立服务的 stdio 契约已经隔离验证，缺少浏览器 display 报告明确标记未核验。

细节见 [架构与字段责任](AGENT_HARNESS_ARCHITECTURE_2026-10-07.md)、[同行交互调研](research/AGENT_CANVAS_INTERACTION_REFERENCES_2026-10-07.md) 和 [作图工作流](EXPRESSION_AGENT_WORKFLOW.md)。
