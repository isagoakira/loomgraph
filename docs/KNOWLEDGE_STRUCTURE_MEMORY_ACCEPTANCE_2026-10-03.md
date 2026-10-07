# 知识结构与有限阅读上下文：样例验收

## 结论

新版 ForecastCompass 样例已形成“连续讲解 + 可延伸知识结构 + 本处可得的概念上下文”。主要修正已落到真实页面、本地项目和现有 MCP 表达读取中。浏览器操作与布局 24/24 通过；已安装 MCP 的八步上下文在每步 24,000 UTF-8 字节预算内往返 8/8 通过。这些检查不证明真人读起来轻松，也不代表通用阅读器或正式安装版本已经升级。

旧样例的文章推进改善成立；此前把数字和按钮检查扩大为整体表达验收通过的判断已校正。本轮验收增加了卡片自足、可遍历关系、局部概念完整性和实际上下文传递。

## 交付入口

- 当前：[knowledge-structure-pilot.html](examples/forecastcompass/knowledge-structure-pilot.html)。
- 保留的前版：[reading-flow-pilot.html](examples/forecastcompass/reading-flow-pilot.html)。
- 每一步的组装上下文：[knowledge-structure-contexts.json](examples/forecastcompass/knowledge-structure-contexts.json)。
- 规范数据与结果引用：[knowledge-structure-pilot-bundle.json](examples/forecastcompass/knowledge-structure-pilot-bundle.json)。
- 本地原生入口：http://127.0.0.1:50448/?graph=forecastcompass-knowledge-structure-pilot 。

## 表达变更

29 个知识中心、55 条有来源的知识关系、7 条独立教学关系、一个总体图与八个局部图。每张卡直接显示名称与必要定义，点击在卡内展开前提、用途、案例和邻接关系；鼠标悬停不会激活。长细则可在卡内滚动，滚动到边界后继续整页阅读。

默认卡面去掉非必要符号；原文符号和公式保留在研究细节。再次使用 F/R、概率、信心、校准、分类索引和轨迹时，必要定义与当前用途在使用处重申。主概念组数和实际新原子数分别登记，不能用“最多三个入口”掩盖一次引入更多概念。

知识边单独记录输入、产物、包含、索引、触发、对照、更新、评价和证据；教学顺序属于步骤级 teachingLinks。复盘轨迹指向原预测轨迹的“对照原预测”边已在总体图与更新局部图显示，不应读成算法执行顺序。

卡片按实际文字高度排布；展开不挪动其他列的起点。连线避开卡片，标签按实际文字宽度放置。窄窗口将局部结构排成纵向并保留关系，避免缩小整图导致文字不可读；纵向视图比桌面更长。

“看关联结构”显示焦点与直接邻接知识；更多关系留在独立说明中。“回到本步结构”恢复原图、展开状态与阅读位置。“定位到主干讲解”提供返回原位置的按钮。

## Agent 上下文传递

源数据明确装配当前理解问题、前一步结论、当前概念及定义、带语义的关系与来源、必要旧概念及本步用途、新概念分组、实际引入数、下一步问题和承接。

项目 metadata.readingMemory 保留完整步骤对象；metadata.expression.readingContext 是现有 expression 读取能直接携带的局部投影。每张图只携带当前知识与必要前提的术语表，以及相关教学边；全局知识关系与完整教学链保存在总体图的 metadata.knowledgeStructure。

在 R105 的实际 MCP 读取中，八步 readingContext 与提交内容完全一致，字节数为 18,352–23,931。部分较长的卡片分节、一跳邻居和几何因预算被省略；omissions 有记录，编辑这些细节仍需补读。完整当前定义、关系和回顾在 readingContext 中保留。

src/expression/prompt.ts 的生成与审阅规则已更新并通过类型检查。新指引尚未随正式构建加载到已安装进程；现有服务能携带上述数据扩展，是通过其已支持的未知字段保留机制验证的。

## 版本与保留证据

项目 cb904f16-a9ec-4a38-831c-d84d9a08df80；工作副本 bdc90254-57fe-4968-97a4-96473ca9868f。

| 修订 | 实际变更 |
| --- | --- |
| R102 → R103 | 增加 29 个实体、9 张图、54 个表示和 49 个局部图关系表示；初始几何通过显式 layout 预检。 |
| R103 → R104 | 修正默认卡面要点，传递阅读上下文与关系语义，保存全局知识关系。 |
| R104 → R105 | 收敛局部术语和教学上下文，确保当前定义与关系在有限预算内完整。 |

49 个原生关系记录是各图的关系表示数量；55 是全局规范关系数量，两者不是同一计数。全局关系另保存在总体图 metadata.knowledgeStructure 和样例 bundle 中。

R102 的 17 张图、56 个实体、46 条关系、77 个表示、39 个自由元素、10 条批注、4 个批次和 1 个资源逐项复读，既无丢失也无字段修改。新建视图不改变原内容与固定几何；浏览行为不创建内容修订。

## 实际验收证据

- [浏览器验收](evidence/knowledge-structure-browser-acceptance-20261003.json)：24/24；1440、900、390 宽度，卡片与标签不重叠、路径不穿卡、无整页横向溢出；卡内展开、邻域延伸、返回、键盘关系说明和原结果切换可操作。
- [MCP 往返](evidence/knowledge-structure-harness-roundtrip-20261003.json)：八步当前阅读上下文在 24KB 预算内完整，8/8。
- [原项目保留](evidence/knowledge-structure-native-preservation-20261003.json)：R102 → R105 原对象、批注与批次逐项未改，包含实际 changeId。
- [来源审计](evidence/knowledge-structure-source-audit-20261003.md)：论文事实、分析和讲解例分开；旧 results/ablation/config 按引用复用。
- [阅读断点审计](evidence/knowledge-structure-reader-audit-20261003.md)：旧缺口、修订与最终关闭记录留痕。
- [桌面图](evidence/knowledge-structure-memory-20261003.png) 与 [窄视图](evidence/knowledge-structure-mobile-20261003.png)。
- 类型检查通过；原生页面实际加载 R105 的六对象双记忆图。原生表达检查没有确定性错误，但该检查不证明事实或阅读理解。

## 尚未被证明或通用化的部分

三个局部图仍有七个节点，且研究证据步骤实际引入八个原子；分组和回顾是必要阅读上下文。这是当前编排选择，未声称满足严格 4–6 节点，更不是人类记忆容量的测量。

原生工作台沿用现有卡片渲染与初始尺寸；样例的自适应排布、关系避障与连续阅读交互尚未移植为通用框架。HTML 预览的批注入口跳转到本地原生工作台，未新增一套预览批注系统。

真人首次阅读、跨概念理解和研究复现仍未验收。论文 104 个结果值沿用前版已核验数组，本轮未运行论文模型实验、安装新构建、改 MCP 配置、提交 Git 或写长期记忆。
