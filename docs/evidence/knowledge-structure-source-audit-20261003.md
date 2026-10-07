# ForecastCompass 知识结构来源与教学边界审计（2026-10-03）

## 结论

`knowledge-structure-pilot-data.mjs` 是对既有 reading-flow 样例的 additive 层。它从旧模块按引用复用 `steps`、`settings`、`results`、`ablation` 和 `config`，只新增知识原子、关系、局部图、总览图、步骤上下文和 `stepBodies`。没有复制或重写旧实验数组，也没有改动 Table 1、Table 3、B.1、B.8 的任何原数值。

新版把“连续文章”与“可局部复用的知识对象”分开：FoCo、待预测问题、结果揭晓、F/R、诊断—聚合—修订、BASE/Static/消融、Table 1/Table 3 都有稳定卡片或关系入口。每张卡只有一个主要知识中心；阶段内天然成组的细节放在卡内 `details`，避免把每个术语机械拆成卡片。

## 来源身份与核验边界

- 唯一论文事实来源是用户指定的 `ForecastCompass: Guiding Agentic Forecasting with Adaptive Factor Memory.pdf`，本地临时抽取 `/tmp/avc-forecastcompass-discussion-20261003.txt` 仅用于定位同一 PDF 的文字，不作为第二个事实来源。
- 旧样例的数值、设置和原文核验结论来自 `reading-flow-source-review-20261003.md`。该报告已经逐项核对 Table 1 的 64 个数字、Table 3 的 40 个数字、四种模型—数据集设置、B.1 参数、B.8 选参和 Brier/ECE 口径。
- `knowledge-structure-reader-audit-20261003.md` 是结构与阅读断点审计，不是论文事实来源；本次新增结构针对其中七类缺口落位。
- 本轮没有运行模型、论文代码、实验、浏览器或 UI，没有安装依赖，没有改动 MCP 配置，没有提交，也没有写入长期记忆。

## 原文事实与教学解释的分层

### `source_reported`

以下内容直接对应论文方法或实验描述，卡片和关系保留原文来源章节：

1. Agent 在时间有效证据上形成概率分布和预测轨迹（§2、§3.2，式 (1)、(4)）。
2. 预测阶段与结果后复盘阶段的信息条件不同，复盘轨迹不能用于当前部署（§2、§3.3，式 (7)）。
3. 层级分类法把问题路由到子类别；每个子类别对应 `M=(F,R)`；F 保存因子名称、证据检查、常见失败和典型概率影响，R 保存证据强弱、不确定性、冲突和缺失如何转成概率的原则（§3.1，式 (2)–(3)）。
4. 预测轨迹与复盘轨迹对照后形成 ΔF/ΔR，经过诊断、聚合和修订，局部更新被选中的记忆内容（§3.3，式 (8)–(10)）。
5. 多类 Brier 以候选结果平方误差求和；ECE 以最大预测概率为信心后分箱比较经验正确率与平均信心；两者越低越好（附录 A.2）。
6. BASE、FoCo (Static) 和 F/R 组件消融各自承担论文中的比较角色；Table 1 是跨评估周的平均主结果，Table 3 固定 FutureX/GPT-5-mini 比较逐周及平均的 F/R 消融（§4.1–§4.4、Table 1/Table 3、附录 A.3）。
7. B.1/B.8 的模型、数据、信息截止、FoCo revision epochs 和 Week 0 development/Week 1 held-out 角色由 `config` 原样引用；未核实项继续保留为待核实。

### `analysis`

以下是为局部阅读和证据边界服务的解释，不能读成论文额外实验结论：

- “F 主要回答看什么，R 主要回答信多少”是对论文两类记忆职责的教学压缩；它不把 F/R 变成可独立相加的数值模块。
- `comparison` 把主结果、静态对照和组件消融放进统一的同条件比较框架；它表达“性能差异的读取方式”，不声称 Table 3 单独识别分类、诊断、聚合或提示模板的独立因果贡献。
- `config` 把模型、数据、时间、指标和待核实项放在一个复现入口，是数据编排；它不补写 SDK 版本、模型快照、ECE 分箱数或工具预算。
- `diagnosis`、`aggregation`、`revision` 分别提供可检索的阶段对象，同时 `revision` 卡内保留三阶段的顺序和局部更新边界；这是为了修复算法链的可遍历性，不是把论文章节改写成新的算法。
- Table 1/Table 3 通过稳定 evidence-claim 卡和 `comparison -> table` 关系可定位；表格数字仍由旧模块导入，结构关系不会改变数字含义。
- 第 7 步的 `comparison` 卡的 `details` 已同时给出完整 FoCo、BASE、FoCo (Static)、F/R 的定义与用途；`stepBodies.evidence` 也在展示 Table 1/Table 3 前先就地说明这些对照对象。因此展开该卡或按证据步骤阅读，都不依赖先回读第 4 步。

### 概念组与实际引入数

`newConceptIds` 保留最多三个主概念入口，供阅读器控制首屏负担；它不冒充该步的全部新增原子。每个步骤同时记录 `newConceptGroups`、`introducedConceptIds` 和 `actualIntroducedCount`，诚实列出首次出现的全部原子。当前实际数为：第 1 步 4、第 2 步 3、第 3 步 2、第 4 步 4、第 5 步 2、第 6 步 5、第 7 步 8、第 8 步 1。组数仍分别为 2、3、2、2、2、3、3、1；组是阅读负担的编排单位，原子数是结构事实。

### `example`

卡片中的选举、70%/30% 和 `.18` 只用于说明概率、信号、信心或 Brier 的读法。它们在正文和卡片中明确写成“讲解例/不是论文实验值”，不能作为本机预测、论文数据或复现实验结果。

## 结构验收记录

- 原子字段均包含稳定 `id`、单一中心的 `title`/`definition`、`role`、来源与 `sourceKind`、八步之一的 `introducedAt`、前置原子和细节卡。
- 关系字段均有稳定 `id`、存在的 `from`/`to`、受限的关系类型、细化的 `semanticType`、中文短标签、完整解释、来源和来源类别。`kind` 保留旧渲染兼容性；`semanticType` 机器可区分索引（`index`）、结构包含（`contains`）、输入或约束（`input`）、触发（`trigger`）、输出（`output`）、对照（`compare`）、评价（`evaluate`）、记忆改变（`update`）和证据依据（`evidence`）。复盘对照边现在从 `retrospective` 指向 `trajectory`，明确表示结果后复盘拿结果后信息对照揭晓前原预测。
- `teachingLinks` 另列八步之间的七条 `teaching_order`，端点是步骤身份而非 atom 身份；它只表达阅读编排，不把教学先后混入算法关系。
- 局部图按旧八步各有一个入口。除 inference/update/evidence 为完整链条而使用 7 个或更少节点外，其余局部图保持 4–6 个节点；`map-update` 还显式保留 `retrospective → trajectory` 的对照边；所有图均为 2–3 列，列内节点均来自 `nodeIds`。
- `stepContexts` 每处最多 3 个主概念组和最多 3 个回顾；`introducedConceptIds`/`actualIntroducedCount` 另行记录实际新增原子。回顾文本自足说明 F/R、概率/信心、校准、子类别、预测/复盘轨迹或协议的当前用途，不依赖超链接。
- `stepBodies` 在概念首次使用前或同时给出定义，并在远距离复用处原位重申。证据步骤重新说明 Brier/ECE、BASE、Static 和 F/R 消融；复现步骤再次说明同一组比较对象和协议。
- `overview` 收为 7 个宏观节点的闭环：FoCo → 双记忆 → Agent → 预测轨迹 → 复盘 → 修订 → 双记忆；预测轨迹再进入比较设计。Brier/ECE、分类法和时间协议留在局部图与邻域延伸，避免首次展示倾倒尚未学习的术语。F/R 的职责在 `memory -> agent` 的关系解释和局部双记忆图中可读。

## 编排阈值的边界

“每处最多 3 个主概念组”“局部图默认 4–6 个节点、最多 7 个”“回顾最多 3 个”等数值是本次有限阅读记忆下的编排启发式，用于缩短跨段复用距离和限制单卡负担；实际新增原子数以 `actualIntroducedCount` 为准。它们不是对人类短时记忆容量、固定注意窗口或阅读心理规律的测量，也不声称存在适用于所有读者的固定数字。后续真人阅读或 UI 反馈可以调整这些阈值，而不会改变论文事实或实验数字。

## 未覆盖范围

本审计没有对新增结构做真人可读性测试、浏览器渲染验收或论文实验复现；根代理负责把数据接入并检查实际画布展示。跨时间/跨模型迁移、记忆质量、长度分析和 bootstrap 统计仍沿用旧样例的范围边界，未在本卡片层擅自扩写为新的证据。
