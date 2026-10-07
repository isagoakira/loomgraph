# 概念图解与分支结构验收

本轮保持 ForecastCompass 的文风、29 个知识中心、55 条规范知识关系、八步主干及原位回顾，加入八张手绘 SVG、53 个有稳定身份的图形部件，并把九张知识图按当前问题的中心与有名称的分支组织。

当前入口：[知识图解样例](examples/forecastcompass/knowledge-structure-pilot.html#step-two-memories)。本机原生图：http://127.0.0.1:58363/?graph=forecastcompass-knowledge-structure-pilot-two-memories 。

## 具体图形表达

| 局部问题 | 图中可直接读出的内容 |
| --- | --- |
| 概率预测 | 候选结果的概率分配条，以及结果揭晓前的信息边界 |
| 信号、信心与校准 | 信心刻度与十次示意预测中七次命中的群体对照 |
| 经验复用 | 从已揭晓个例抽取搜证检查与信心控制两路原则 |
| 双记忆 | 分类文件夹及目录树、F 的放大镜和检查清单、R 的证据强弱与信心刻度 |
| 一次新预测 | 经验两路参与搜证与概率判断，并留下当前预测过程 |
| 结果后更新 | 时间边界、原预测与结果后复盘两条记录、差异诊断与未来记忆修订 |
| 实验证据 | Brier 与 ECE 两种评价对象、限定设置的主结果与 F/R 消融数表 |
| 复现设计 | 固定共同条件、并行对照分支及记忆/更新的可视化开关 |

图中的讲解数字、类比和开关均标为示意。Table 1 的选取范围明确为 GPT-5-mini/FutureX；Brier/ECE 直接写出名称。图解连接标为 illustrative，评价和证据的对照线不带执行箭头；知识卡片保留原有规范关系、动词和方向。总体图使用中心分支与原有反馈关系，没有单独生成第九张概念 SVG。

点击图中部件，就地出现定义和当前图中的用途，并聚焦相关卡片；可进一步打开同一张知识卡。键盘可激活，悬停不打开。卡片展开、沿关系延伸、返回恢复及原论文表切换均保留。较窄窗口采用有名称的嵌套分支；SVG 保留原始字号，可在图内横向查看，整页不溢出。

## 实际验证

- [真实浏览器](evidence/concept-diagrams-browser-acceptance-20261003.json)：36/36，1440、900、390 宽度；图文几何、部件点击与键盘、卡片展开、邻域返回及原结果表通过。
- [MCP 往返](evidence/concept-diagrams-harness-roundtrip-20261003.json)：R115 八步 8/8；每步 24,000 UTF-8 字节预算，实际 21,225–23,895 字节。readingContext 和 visualContext 均与提交内容完整一致。长细则、部分邻域、图形元素和几何的省略有记录，编辑时仍需补读。
- [原项目保留](evidence/concept-diagrams-native-preservation-20261003.json)：R105 的 85 个实体、95 条原生关系、131 个表示、39 个自由元素、10 条批注、4 个批次及原资源逐项未改；26 张图除声明的图例上下文和图片阅读锚点外未改。
- 原结果、消融与配置的整体 SHA-256 与[本轮基线](evidence/concept-diagrams-baseline-20261003.json)一致；类型检查通过。
- [来源审计](evidence/knowledge-concept-figures-source-audit-20261003.md)及[读者语义审计](evidence/knowledge-concept-diagram-reader-audit-20261003.md)区分论文事实、教学示意和可视化组织。读者审计是静态审阅。
- [交互样例截图](evidence/concept-diagrams-memory-desktop-20261003.png)；[本地画布截图](evidence/concept-diagrams-native-memory-20261003.png)。

## 本地版本

项目 cb904f16-a9ec-4a38-831c-d84d9a08df80；工作副本 bdc90254-57fe-4968-97a4-96473ca9868f。

R106–R113 保存八张初始 SVG；R114 收敛窄视图的证据图标签，并保留旧资源。R115 新增八个图片元素、更新九张图的视觉上下文与阅读锚点，changeId 为 0e241182-7093-4566-ae92-08959203e697。操作先按明确 layout 动作及九图/八元素范围完成只读预检，valid=true、issues=[]，再使用 R114 基线提交。

当前八张图片引用八个 SVG 资源；另一个已被替代的证据图资源留在版本历史中。图形部件采用 figureId + partId 的复合身份，声明 atomId、visualRole、sourceKind、含义和 box。memory-problem 的原始记录属于 lesson 的 supporting_example，避免提前等同于正式复盘轨迹。

## 实现与边界

生成器：scripts/build-knowledge-structure-pilot.mjs；图例：scripts/knowledge-concept-figures.mjs；视角组织：scripts/knowledge-structure-topology.mjs。独立 SVG 在 examples/forecastcompass/concept-figures/。本轮没有新增模型服务或图像生成依赖。

交互图例和中心分支排布目前在此样例实现。本地通用工作台已保存并呈现图例图片及部件语义，图中部件点击的交互仍属于 HTML 样例；通用渲染器的卡片和排布没有替换。src/expression/prompt.ts 的新编排指引已更新且通过类型检查，未构建安装新版本或重启 MCP；实际上下文往返依靠现有进程保留扩展字段的能力。

真人首次阅读、Windows 实机、模型实验复现及性能上限没有在本轮验收。原项目包恢复、迁移和正式安装工作没有由本样例扩展测试代替。
