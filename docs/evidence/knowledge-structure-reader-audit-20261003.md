# ForecastCompass 知识结构读者审计（2026-10-03）

## 审计范围与结论

本审计只读取：

- plugins/agent-visual-canvas/docs/examples/forecastcompass/reading-flow-pilot-data.mjs
- plugins/agent-visual-canvas/docs/evidence/reading-flow-reader-review-20261003.md
- plugins/agent-visual-canvas/AGENTS.md

这里审的是样例能否作为“可局部读取、可复用的知识图谱数据”，不是对连续文章的真人可读性测试，也没有做真人测试、运行实验或 UI 验证。旧 reader review 证明主干文章可以按“概率 → 证据/信心 → 双记忆 → 预测 → 更新 → 实验”顺读；这不等于数据已经具有知识图谱所需的卡片、局部关系和可定位复用。

核心结论：旧样例仍是“文章段落挂在步骤上的阅读流 bundle”。concepts 是平面定义数组，steps.body 和 steps.sections[].html 承载真正的解释，requires/introduces/uses/next 只提供阅读流标记，没有显式、可区分语义的关系图。读者要回答“哪一张手册指导哪个动作”“结果揭晓后哪个对象被更新”“这条数字由哪项证据支持”，仍需回到前后段落查找。

## 现有样例的可复现缺口

### 缺口 1：没有可遍历的结构关系，requires/uses/next 不能替代图边

**位置：** reading-flow-pilot-data.mjs:4-18, 64-129。

concepts 只产生 {id, term, definition}，文件没有 relations/edges 集合。步骤的 requires、introduces、uses 是概念 ID 列表，next 是一段自然语言；它们不写明边的方向或关系类型。比如正文说“双记忆”由 F 和 R 组成、子类别用于找到对应手册、Agent 用 F 检查信号并用 R 调整信心、复盘对照预测轨迹后修订记忆，但加载 bundle 后无法查询这些关系。

**复现方式：** 枚举 bundle.concepts 和 bundle.steps，可得到节点和步骤标记，却找不到一条带 source、target、relation 的边。next 也不能指向下一张卡的稳定 ID。

**读者后果：** 图形界面只能把段落按顺序排版，不能把“当前卡片附近的 4–6 个节点及其关系”直接展示出来。

### 缺口 2：核心概念卡不自足，关键定义被推迟到隐藏的研究展开

**位置：** reading-flow-pilot-data.mjs:9-14, 95, 103。

“预测子类别”“双记忆”“预测轨迹”的定义分别写着“形式符号 s/M/z 在研究展开中定义”。真正的作用和符号关系只在后面的 sections[].html 中补充。若卡片只显示主定义，读者不知道子类别如何连接记忆，不知道双记忆的两个组成对象，也不知道预测轨迹与结果后复盘轨迹为何不同。

这也违反了“每张卡有自足定义和作用”的最低要求：卡片不应把理解核心作用的内容交给全部弹窗或向后翻页。符号可以保留为可选形式化字段，但不能承担首次定义。

### 缺口 3：关键复用对象没有稳定卡片，名词被埋在正文或表格元数据里

**位置：** reading-flow-pilot-data.mjs:20-21, 43-48, 85-87, 109-119, 123-127。

FoCo 只在第 3 步正文出现，BASE、FoCo (Static)、BASE (Retro) 主要出现在 methods 和段落中；“诊断、聚合、修订、结果/揭晓、当前证据、问题 q、预测概率 p”等过程对象也没有对应概念卡。它们却在第 6–8 步承担算法动作或比较结论。

**复现方式：** 用 concepts.map(c => c.id) 与正文、methods、ablation 中出现的核心对象对照，可见 FoCo、BASE、retrospective 之外的更新动作没有可链接的节点；FoCo 也不在 concepts 中。results.configId 和 ablation.configId 只是表格连接键，不是面向读者的结构关系。

**读者后果：** 读者第二次看到“静态 FoCo”“去掉 F/R”“只更新受影响内容”时，没有一个可点击回到定义和作用的稳定入口。

### 缺口 4：一个步骤混入多个中心，真正的知识单元仍是长文章

**位置：** reading-flow-pilot-data.mjs:106-111, 114-119, 122-127。

update 同时讲结果揭晓、复盘轨迹、原预测对照、诊断、聚合、修订、F/R 局部更新、保留原记录、分类扩展、差异 ΔF/ΔR 和迭代 N；evidence 同时讲 Brier/ECE 定义、BASE/静态/动态比较、Table 1、Table 3 消融、逐周反向结果、bootstrap 边界；reproduction 又把配置缺项、迁移方案和未来假设放在同一张步骤卡里。sections[].html 是不透明 HTML，无法在结构层面知道哪句话是定义、哪句话是执行动作、哪句话是证据限制。

**该拆/该合的边界：**

- “双记忆”可以作为一个中心卡，F 与 R 作为两个有明确作用的子节点；不必把每个“信号名称”“冲突”“缺失”等词再拆成单卡。
- “更新”至少应拆成“结果后生成复盘并对照原预测”“从差异诊断/聚合出可复用模式”“局部修订 F/R 且未来生效”三个有顺序的中心卡。
- “指标定义”和“比较结果/消融解读”应分开；“配置与迁移建议”也不应与结果证据共用一个中心卡。

### 缺口 5：局部概念引入不完整，复用距离超过一张卡且没有原位复述

**位置：** reading-flow-pilot-data.mjs:90-119, 122-127。

有几条可直接复现的远距离复用：

1. factor/reasoning 在第 4 步定义为“F 看什么、R 信多少”，第 7 步正文只写“去掉 F 或 R”并用它们解释消融，却没有原位重述两者的作用；读者需向前找第 4 步。
2. trajectory 在第 5 步定义为预测时搜到的证据和判断过程，第 6 步只写“原预测与复盘轨迹的差异”，没有在原位说明两条轨迹分别来自哪个时间点；“它”也依靠前文指代。
3. protocol 只在平面 concepts 数组中定义，直到第 8 步才被 requires 引入；第 7 步虽然列出固定模型、题集和指标，却没有告诉当前卡片这些字段合在一起就是比较协议。
4. calibration 在第 2 步解释，后面转为 ECE 和“校准误差”时没有把“信心与实际正确频率的匹配”重新接回指标卡。

**最低修补形态：** 远距离使用旧概念时，当前卡片应带一句“原位复述 + 当前用途”，例如“F 仍表示检查应看什么，R 仍表示证据强弱如何改变信心；本消融分别移除它们来比较作用”。只把 ID 放入 requires/uses 不足以解决人类上下文有限的问题。

### 缺口 6：同一字段混用讲解顺序、结构包含、算法执行和证据关系

**位置：** reading-flow-pilot-data.mjs:67, 75, 83, 91, 99, 107, 115, 123 及 38-61。

requires 看起来像讲解前置，但也可能被理解成算法输入；uses 只是“本段提到”，却和真正的执行依赖并列；introduces 是教学时机，不是结构包含；next 是叙述过渡，不是算法下一步。例如 update.requires 列出 factor、reasoning，但没有说明它们是被读取、被诊断还是被更新；evidence.uses 列出 F/R，实际语义却是“被消融比较”。

同样，source/sourceSection/sourceKind 只挂在整步上，不能区分“Table 1 支持总体均值”“Table 3 支持 F/R 消融”“.18 只是教学例子”这三种证据语义。

**验收需要的关系分层：** 至少分开 teaches_before（讲解顺序）、contains/member_of（结构包含）、reads/produces/updates（算法执行）、supported_by/illustrates（证据支持或讲解示例）。同一条边不应靠 requires 的上下文猜语义。

### 缺口 7：最重要的算法链和证据链只存在于段落，不是局部图

**位置：** reading-flow-pilot-data.mjs:101-111, 117-119。

算法链“问题分类 → 取对应 F/R → 用 F 检查当前信号 → 用 R 处理证据强弱/冲突 → 输出概率并保留预测轨迹”只写在正文；更新链“结果揭晓 → 生成复盘 → 对照原预测 → 诊断 → 聚合 → 修订 → 未来使用”主要写在正文和 HTML。证据链“指标定义 → Table 1 主结果 / Table 3 消融 → 平均与逐周解释”也没有按主张逐条连边。

因此即使读者已经读过全文，也不能从一个局部焦点卡直接判断：哪一个对象是输入、哪一个是产物、哪一个被修改、哪一条数值由哪张表支持。把 sections[].html 展开只会让文章更长，不会产生这些结构关系。

## 最低可验证验收条件

下面是新版样例至少应满足的静态内容检查；这些条件不要求真人测试，也不要求先运行论文实验。

1. **卡片自足。** 每个核心卡有稳定 id、一个中心主题、面向读者的定义和作用。subcategory、memory、trajectory 不得仅写“符号见研究展开”；关键作用在卡片本身可读，符号与公式只能是补充。
2. **显式关系。** 数据中存在可枚举的关系集合，每条关系都有稳定 source、target 和明确 type；目标 ID 必须存在。至少可直接遍历以下局部链：
   - subcategory → retrieves/locates → memory → contains → factor/reasoning；
   - question + current evidence + memory → produces → probability + prediction trajectory；
   - outcome → triggers → retrospective → compares_with → prediction trajectory；
   - diagnosis/aggregation → updates → factor/reasoning，且更新后的记忆 applies_to → future prediction；
   - protocol → constrains → setting/result，result claim → supported_by → Table 1/Table 3。
3. **语义不混淆。** 讲解顺序、结构包含、算法执行、证据支持必须使用可区分的关系类型；不能用一个 requires 或自然语言 next 兼任。sourceKind:"example" 应表达“讲解示例”，不能被误读为论文实验支持。
4. **局部可读。** 对上面每条局部链，任选焦点卡时，4–6 个相关节点和边能在同一局部数据视图中读懂；不需要打开所有弹窗或回读整篇文章。局部边的标签要写清“看什么/信多少/读取/更新/支持”等关系语义。
5. **远距复用有原位复述。** 对首次定义与当前使用相隔超过一个教学步骤的 factor、reasoning、trajectory、calibration、protocol、FoCo/static 等对象，当前卡需有一句定义复述并说明当前用途；仅在 requires/uses 中列 ID 不算通过。
6. **一卡一中心，适度原子化。** update、evidence、reproduction 中的独立问题必须拆成可单独复用的中心卡；同一操作中天然成组的对象应保留父子关系（例如“双记忆”下的 F/R、指标组下的 Brier/ECE），不得把每个名词机械拆成一张卡来制造数量。
7. **证据粒度可核查。** 主结果、消融、教学例子、分析建议各自有可定位的证据关系或状态；读者能区分“Table 1 的总体均值”“Table 3 的局部周结果”和“.18 的讲解计算”，不能只看到整步共用的 source 字段。

## 复核边界

本报告记录的是旧 reading-flow-pilot-data.mjs 的静态缺口。它没有把旧 reader review 中已经通过的连续阅读结论重新判为失败，也没有把文章可读性问题冒充成真人测试结果。待 knowledge-structure-pilot-data.mjs 出现后，应按上述 7 条逐条检查新版是否真正提供卡片与关系；届时另记“已解决/仍断层”，不以字段命名相似替代关系语义验证。

## 新版复核（2026-10-03）

本次复核读取了 knowledge-structure-pilot-data.mjs 的 29 个 atoms、51 条 edges、8 个 localMaps、10 个 overview 节点、8 组 stepContexts 和 8 组 stepBodies。只做静态内容检查，不查看未提供的 UI，不声称做过真人测试。

### 已实质解决的部分

1. **卡片自足性大幅改善。** 29 个 atom 都有 id、title、definition、role 和 introducedAt；subcategory、memory、trajectory、FoCo、诊断、聚合、修订、Brier/ECE、Table 1/Table 3 等核心对象已经有独立作用说明，不再把首次理解完全推迟到公式弹窗。
2. **全局关系可遍历。** 51 条 edge 的 from/to 都能解析到 atom，8 个 localMap 引用的 nodeId/edgeId 也都存在。FoCo → taxonomy → subcategory → memory → F/R、预测 → 轨迹、结果 → 复盘 → 诊断 → 聚合 → 修订、指标 → 比较证据等主链已经有方向和说明文字。
3. **长距离回顾大多已经落地。** stepContexts 和 stepBodies 对 F/R、轨迹与复盘、概率与信心、Brier/ECE、BASE/Static 等对象写了原位复述；update 的三段正文明确区分揭晓前 z、揭晓后 z_retro，以及 F/R 的局部修订。旧报告中“只给 ID、不复述”的主要断层已经缓解。
4. **证据粒度明显变细。** Table 1 主结果、Table 3 消融、教学用 .18 与复现配置分别有 atom 和 sourceKind，读者可以区分总体均值、固定条件的组件对照和教学计算。

### 仍会卡住第一次接触者的实质断点

#### 断点 A：默认 overview 不是闭合的 ForecastCompass 局部图

**位置：** knowledge-structure-pilot-data.mjs:1030-1062。

overview 的 claim 直接说“FoCo 用时间协议守住预测边界，把问题路由到双记忆……Brier/ECE 评价这条闭环”，但 nodeIds 没有 foco、forecast-question、subcategory、factor、reasoning、probability 或 outcome。它只显示 taxonomy → memory → agent → trajectory → retrospective → revision 一条主链，另有 brier → comparison ← ece 的独立指标岛；静态检查得到两个连通分量：

- agent / memory / trajectory / taxonomy / retrospective / revision / protocol；
- brier / comparison / ece。

因此第一次看到默认图的人看不到“FoCo 这个方法”本身，看不到双记忆由 F/R 组成，也看不到概率输出和结果揭晓事件；指标岛又没有通过 comparison → foco 或 result-claim → method 的边连接回主流程。overview 可以是压缩总览，但当前压缩删掉了理解 claim 所需的中心节点，且留下两个无解释连接的岛。

**最低修补条件：** 保留 10 节点上限时，至少要用一个明确的 FoCo 节点、一个双记忆/F-R 表示、一个预测输出节点把方法闭环和指标闭环连接起来；或者把 overview 明确标成非默认的摘要图，并提供一个 4–6 节点的可读默认局部图。只在 claim 文字中出现 FoCo 不算图中已有该概念。

#### 断点 B：多个 localMap 超过 4–6 节点，且删掉了理解动作所需的节点

**位置：** knowledge-structure-pilot-data.mjs:993-1027。

- map-inference 有 7 个节点，但没有 agent 和 signal。图中有 factor → trajectory、reasoning → probability，却没有“谁执行搜证/输出轨迹”的 Agent，也没有 F 实际检查的 signal；读者只能从 stepBody 文字补回这两个动作。
- map-update 有 7 个节点，但没有 factor/reasoning 和 protocol。图中只显示 revision → memory，不能从局部边读出“更新的是 F/R 哪些部分”，也不能看到时序约束；stepContexts 的提醒文字虽提到 F/R，但这不是局部图中的显式关系。
- map-evidence 有 7 个节点，但没有 calibration 和 protocol。ECE 节点通过局部边只连到 confidence，没有 ece → calibration；comparison 也看不到协议约束。读者能读正文，却不能从默认证据图直接得到“ECE 回答校准匹配”和“比较必须在同协议下”。

这些 map 同时违反“局部 4–6 节点”的可读负担约束和“关系链不能删掉必要依赖”的内容要求。问题不是节点数量本身，而是多塞了一个总括节点后，反而删掉了执行者、输入或被更新的具体组件。

**最低修补条件：** 每个默认局部图压到 4–6 个中心节点；若需要保留额外依赖，应将其合并为有定义的父卡（如“当前预测执行”或“双记忆”），并保留可读的 typed edge，而不是从局部图删掉 Agent、signal、F/R、calibration 等必要角色。

#### 断点 C：memory-problem 局部图中的 FoCo 是孤立新概念

**位置：** knowledge-structure-pilot-data.mjs:975-981；FoCo atom 在 141-152；protocol/FoCo 前置关系在 69-81、148-152。

map-memory-problem 的 nodeIds 包含 signal、calibration、lesson、foco、protocol，但 edgeIds 只有 signal → lesson、calibration → lesson、protocol → lesson；foco 在该局部图中没有任何边。该 map 的 claim 和 stepBody 又把 FoCo 作为“把原则组织起来的方法”引入，第一次接触者会看到一个没有来源、作用或连接的孤立卡。

FoCo atom 自己还声明 prerequisites 为 lesson 和 protocol；当前局部图没有 lesson → foco，也没有 protocol → foco 的关系。protocol → lesson 只能说明原则受时序边界约束，不能说明为什么这两个输入共同导出 FoCo。

**最低修补条件：** 为“可复用原则 → FoCo 方法”增加明确的 implements/organizes/uses 关系，并把时序协议对 FoCo 的约束表达在同一局部图；若设计上不需要 protocol 作为 FoCo 的前置，就应删除 atom 的该 prerequisite，而不是留下未解释依赖。

#### 断点 D：introducedAt 与 stepContexts.newConceptIds 不一致

**位置：** atoms 定义与 introducedAt 分布在 knowledge-structure-pilot-data.mjs:22-440；stepContexts 在 1064-1132。

静态对照发现以下 atom 声明在某一步首次引入，却没有出现在该步的 newConceptIds：

- probability @ probability；
- subcategory @ two-memories；
- diagnosis、aggregation @ update；
- base、static、ablation、table1-result、table3-ablation @ evidence。

例如 subcategory 在 atom:169-181 的 introducedAt 是 two-memories，正文 1151 也第一次解释它，但 two-memories context（1087-1094）只登记 taxonomy、factor、reasoning；update 的 diagnosis/aggregation 和 evidence 的五个比较/证据对象也有同样问题。若内容消费者按 newConceptIds 决定“本步新出现哪些卡”，这些概念会以没有首次引入标记的方式进入图，读者需要猜它们是前置概念还是当前概念。

**最低修补条件：** 统一 introducedAt 与 newConceptIds 的语义：要么把上述 atom 全部登记为该步新概念，要么明确 newConceptIds 只表示“步骤焦点卡”并另加 firstSeenIds/introducedAtoms，不能让同一个字段看起来像完整新概念清单而实际漏项。

#### 断点 E：边 kind 仍有语义重载，部分方向会误导

**位置：** knowledge-structure-pilot-data.mjs:442-953。

新版已经有 kind、label、explanation，这是明显进步；但以下 kind 仍混用不同关系：

- contains 同时用于 FoCo → taxonomy 的“组织”、taxonomy → subcategory 的层级包含、subcategory → memory 的索引定位，以及 comparison → BASE/Static/ablation 的比较版本归属。前三者至少应区分 organizes/indexes/contains，最后一类更像 has_variant。
- requires 同时用于 question → agent、question → trajectory、protocol → revision 和 config → comparison，分别是任务输入、记录范围、时序约束和实验依赖。
- produces 同时用于 outcome → retrospective（结果触发）、retrospective → revision（学习信号驱动）、diagnosis → aggregation（算法产物）。这些可保留同一大类，但若要让第一次读者理解执行关系，至少要用 trigger/feeds/produces 或在 kind 外增加明确的 executionRole。
- trajectory → retrospective 使用 kind compares，但 from 是原预测轨迹，实际执行者是“复盘轨迹拿结果后信息来对照原预测”；边方向和标签容易让人误以为预测轨迹主动生成复盘。

此外没有显式 teaches_before 边；教学顺序仍隐含在 steps 数组顺序、introducedAt 和 stepId 中。requires/数组顺序能供程序猜顺序，但不能把讲解顺序与算法依赖同时作为可查询关系。

**最低修补条件：** 为结构包含、索引定位、方法变体、算法触发/输入/产物、教学先后分别使用可区分的 kind，或在同一 kind 下增加明确的语义字段；修正 trajectory/retrospective 的比较方向。不能仅靠中文 explanation 让读者自行判断边的类别。

#### 断点 F：局部图依赖仍主要靠 stepBody/reminder 文本兜底

**位置：** stepContexts 1064-1132、stepBodies 1134-1175；localMaps 955-1028。

新版的 stepBodies 已经能连续讲解，许多远距回顾因此通过；但 atom prerequisites 与 localMap 节点并不一致。例如 map-inference 中 memory 的前置 subcategory、trajectory 的前置 agent 未在图中；map-reproduction 中 config 的 brier/ece 前置、static 的 foco 前置、ablation 的 factor/reasoning 前置也未在图中。当前正文或 reminders 会补回这些概念，但只要局部阅读入口优先显示 map 而把正文折叠，依赖仍然断开。

这不是要求每张图复制整个知识库，而是要求每个局部图至少保留当前中心概念的必要输入，或者把缺失输入明确作为同一局部的 recap 节点/关系。现在的内容同时声称 atoms 有 prerequisites、maps 是局部关系，却没有规定这两套入口谁负责承载必要依赖。

### 按旧版 7 条验收条件的结论

| 条件 | 新版判断 | 证据与剩余问题 |
| --- | --- | --- |
| 卡片自足 | 基本通过 | atom 定义/作用齐全；仍需解决局部图删掉必要依赖的问题。 |
| 显式关系 | 全局通过，局部有断点 | 51 条边端点完整；overview 与多个 localMap 未保留闭合主链。 |
| 语义不混淆 | 部分通过 | kind/label/explanation 已有；contains、requires、produces、compares 仍重载，缺少教学顺序边。 |
| 局部 4–6 节点可读 | 未完全通过 | inference/update/evidence 各 7 节点；overview 10 节点且分成两个连通分量。 |
| 远距复用有原位复述 | 正文基本通过，元数据不一致 | stepBodies/reminders 很好；introducedAt 与 newConceptIds 漏登 9 个首次概念，局部图仍漏必要前置。 |
| 一卡一中心、适度原子化 | atom 层通过，局部图需收缩 | 原子卡中心清楚；部分局部图为压缩而删掉动作角色，不能靠继续加卡解决。 |
| 证据粒度可核查 | 基本通过 | Table 1/Table 3/.18/config 已分卡；overview 未把证据岛接回 FoCo 主链。 |

新版已经从“文章挂在步骤上”跨到“有原子卡和全局关系的结构化样例”，不应回退到旧方案。当前阻断第一次接触者的优先级是：先修默认 overview 的中心概念与连通性，再修 inference/update/evidence 的局部必要节点和 4–6 节点负担，随后统一 introducedAt/newConceptIds 和边语义。上述判断只基于数据内容；未检查 UI 如何选择 overview、是否始终显示 reminders 或如何折叠 stepBodies。

## 最终静态复核（2026-10-03，修订版）

修订版当前导出 29 个 atoms、55 条 edges、8 个 localMaps、7 个 overview 节点、8 组 stepContexts 和 8 组 stepBodies。静态检查确认所有 edge 的端点、localMap 的节点/边引用都有效；8 个 localMap 与 overview 现在各自是单一连通分量。

### 已解决的断点

- **三个断开的局部图已补齐。** map-signal-confidence 增加 confidence → calibration；map-memory-problem 增加 lesson → foco；overview 改为 foco → memory → agent → trajectory → retrospective → revision，并通过 trajectory → comparison 接回评价入口。原先的孤立节点和指标孤岛已消失。
- **首次引入登记已可核对。** introducedConceptIds 与 atoms 的 introducedAt 逐步完全一致，actualIntroducedCount 也逐项相符：第一步 4 个、第二步 3 个、memory-problem 2 个、two-memories 4 个、inference 2 个、update 5 个、evidence 8 个、reproduction 1 个。newConceptIds 现在可以解释为步骤焦点子集，newConceptGroups 明确把“预测框架”“分类索引”“双手册分工”“比较版本”“表格证据”等成组对象收拢起来，没有再把漏登伪装成完整首次清单。
- **远距复用基本自足。** stepContexts 的 reminders 和 stepBodies 已在原位重述 F/R 分工、预测轨迹与复盘轨迹的时间身份、概率与信心关系，以及协议的时间边界。update 明确“更新对象是当前子类别的双记忆状态，即因子手册与推理手册的组合”；evidence 说明真实结果的 one-hot 口径和事后复盘不进入当前预测。
- **第 7 步比较对象已经就地定义。** comparison atom 在 knowledge-structure-pilot-data.mjs:340-354 就地说明 BASE、FoCo (Static)、F/R 分工、完整 FoCo 和组件消融；evidence stepBodies 在 1252-1255 再次说明 Table 1 的总体均值、Table 3 的 FutureX/GPT-5-mini 固定条件和 F/R 去除含义。读者不需要跳到 reproduction 才知道这些词指什么。
- **符号和事后信息负担下降。** inference/update 的正文使用“双记忆状态”“预测轨迹”“复盘轨迹”和“事后信息偏差”等读者可读表达；保留符号的地方仍有对应 atom 定义，且没有把事后复盘改写成可部署预测。

### 仍需保留在验收记录中的两个残留点

#### 残留 1：三个 localMap 仍是 7 节点，分组还没有改变图节点数

**位置：** knowledge-structure-pilot-data.mjs:1035-1059；stepContexts 的分组在 1158-1203。

map-inference、map-update、map-evidence 各有 7 个 nodeIds。stepContexts 的 groups 能把这些概念按“可检索记忆/预测过程记录”“结果后阶段/差异处理/局部写回”“评价指标/比较版本/表格证据”组织起来，也让正文可顺读；但 localMaps 本身仍是 7 节点。若局部图直接按 nodeIds 展示，仍超过原先约定的 4–6 节点窗口：inference 没有把 Agent 作为节点放入图，update 没有把 F/R 的更新边放入图，evidence 没有把 calibration/protocol 放入图。当前内容可以靠 atom 自足定义和 reminders 补回这些依赖，但这项验收不能称为“纯局部图已通过”。

这属于剩余的结构负担，不是旧版那种“完全没有关系图”的断点。最终验收应二选一：将这些 localMap 改为 4–6 个有定义的父卡/中心节点，或明确把 newConceptGroups/reminders 视为局部视图的一部分并在数据契约中写清楚，不能只假定渲染器会自动替换节点。

#### 残留 2：边 kind 仍表达多种关系，方向主要靠中文 explanation 消歧

**位置：** knowledge-structure-pilot-data.mjs:442-990。

全局边已具备 kind、label、explanation，但 kind 集合仍是 requires、grounds、produces、guides、contains、compares、updates、evaluates。contains 同时表示 FoCo 组织 taxonomy、taxonomy 包含 subcategory、subcategory 索引 memory 和 comparison 持有 BASE/Static/ablation；requires 同时表示问题给 Agent/轨迹提供范围、协议约束修订和配置约束比较；produces 同时表示结果触发复盘、诊断产出聚合以及聚合产出修订。trajectory → retrospective 仍以预测轨迹为 from、kind=compares，实际叙述是复盘轨迹拿结果后信息对照原预测。

这些边有中文 label/explanation 时基本可读，因而不再是当前首要阻断；但如果下游只按 kind 做样式或筛选，读者仍可能把“结构包含”“索引定位”“算法触发”“证据支持”混为一类。数据也没有显式 teaches_before 边，教学先后仍由 stepId/introducedAt/数组顺序间接表达。后续契约应增加更细的关系类型或 executionRole/teachingOrder 字段，并把比较方向改成“复盘对照预测轨迹”。

### 最终验收结论

| 条件 | 最终判断 | 依据 |
| --- | --- | --- |
| 每张卡一个中心，定义和作用自足 | 通过 | 29 个 atom 字段齐全；F/R、FoCo、BASE/Static、指标和证据均有独立作用。 |
| 全局关系可遍历 | 通过 | 55 条边端点有效；所有 localMap/overview 引用有效且连通。 |
| 远距回顾与局部新概念依赖 | 基本通过 | reminders、stepBodies、introducedConceptIds、newConceptGroups 已补齐；局部图仍依赖这些辅助视图承载部分前置概念。 |
| 关系语义不混淆 | 部分通过 | label/explanation 足够解释当前文本；kind 仍重载，教学顺序未成为显式边。 |
| 局部 4–6 节点可读 | 未完全通过 | 三个 localMap 仍为 7 节点；分组减轻了正文负担，但未改变结构数组的节点数。 |
| 适度原子化而不制造名词卡负担 | 通过 | 新概念按 groups 聚合，核心操作保持一个中心；没有回到逐名词拆卡。 |
| 证据与比较关系可核查 | 通过 | comparison atom 和 evidence 正文就地定义 FoCo/BASE/Static/F/R；Table 1/Table 3/.18 的口径已分开。 |

因此，修订版已解决旧样例从文章到知识图谱的主要断层，可以作为结构化样例继续接入。报告仍保留两项明确的剩余风险：严格 4–6 节点约束尚未在三个 localMap 的数据层通过，关系 kind 仍需要更细语义才能让下游无需依赖 explanation 猜关系。以上结论只基于当前数据静态检查，没有检查 UI 是否显示 groups/reminders，也没有真人测试。

## 关系语义与教学链小范围复核（2026-10-03，最终）

本次只读复核重新加载了 `knowledge-structure-pilot-data.mjs`，针对上一节提出的三个修订点检查字段完整性、引用和方向；没有检查 UI、生成页面的实际显示或真人理解。

### 已确认的修订

1. **边已有可筛选的细分语义。** 55 条 edge 均有非空 `semanticType`，当前分布为 `input` 17、`evidence` 8、`compare` 7、`output` 6、`evaluate` 5、`contains` 4、`index` 3、`trigger` 2、`update` 3。这样下游可以按执行输入、产物、证据、索引/包含、触发、比较、更新和评价分开处理；原有 `kind` 字段仍保留，因此若消费者只读取 `kind`，旧的语义重载风险仍存在。
2. **教学顺序已从算法边中分离。** `teachingLinks` 单独导出 7 条 `scope: "step"` 关系，`semanticType` 统一为 `teaching_order`，`order` 为 1–7 且 from/to 均指向有效步骤。教学顺序不再只能从 steps 数组、`introducedAt` 或边数组顺序推断。
3. **复盘对照方向已修正。** `e-trajectory-retrospective` 现在从 `retrospective` 指向 `trajectory`，标签为“对照原预测”，解释明确写出复盘使用结果后信息来对照揭晓前原预测；overview 也保留了这条边。

### 仍需记录的局部限制

- `map-update` 的 7 个 nodeIds 同时包含 `trajectory` 和 `retrospective`，但其 `edgeIds` 仍没有 `e-trajectory-retrospective`。因此全局边和 overview 的方向已正确，结果后更新局部图却仍不能直接显示“两条轨迹相互对照”的 typed edge；当前需由 map claim、stepBody 或其它诊断边补回这层关系。
- `map-inference`、`map-update`、`map-evidence` 仍各有 7 个节点。本次按 root 任务约定，将 `newConceptGroups` 与 `reminders` 视为同一局部阅读上下文来解释其可读性；这不等于数据层严格满足 4–6 节点阈值。
- 本次验证的对象是源数据模块；未把生成 JSON、HTML payload 或 UI 是否消费 `teachingLinks` 纳入通过条件。仍未进行真人测试。

### 本次复核结论

关系细分、独立教学链和复盘比较方向三项源数据修订均已静态通过；“kind 仍重载”已由 `semanticType` 提供可用的并行筛选字段，降为兼容性残留。局部更新图漏列复盘—原预测比较边，以及三个 7 节点局部图，仍应保留在最终验收记录中。

## 局部更新比较边关闭记录（2026-10-03）

再次直接复读 `knowledge-structure-pilot-data.mjs:1099-1105`，确认 `map-update.edgeIds` 已加入 `e-trajectory-retrospective`。该 edge 当前为 `retrospective → trajectory`，标签为“对照原预测”，`semanticType: "compare"`；因此上一节记录的“局部更新图漏列复盘—原预测比较边”已关闭。

本条只记录源文件静态复核。root 提供的浏览器 24/24 验收、已安装 MCP R105 八步阅读上下文 8/8 往返及 groups/reminders 显示结果属于外部验收证据，本报告引用其结论但不将其计为本次直接 UI 或真人测试。
