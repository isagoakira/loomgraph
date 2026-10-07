# ForecastCompass 概念图模块来源审计（2026-10-03）

## 审计范围

本审计对应新增模块：

- `plugins/agent-visual-canvas/scripts/knowledge-concept-figures.mjs`

模块只读取 `knowledge-structure-pilot-data.mjs` 已有的 `atoms`、`edges`、`steps`、`results` 和 `ablation`，没有改写这些数据，也没有新增 atom、canonical edge 或 overview figure。它为 8 个教学步骤导出 8 张 SVG 概念图，共 53 个可交互 figure parts。

## 图与已有 atom 覆盖

| step | figure | parts 使用的 atom |
| --- | --- | --- |
| probability | `figure-probability` | `forecast-question`, `agent`, `probability`, `protocol` |
| signal-confidence | `figure-signal-confidence` | `signal`, `confidence`, `calibration`, `protocol` |
| memory-problem | `figure-memory-problem` | `retrospective`, `signal`, `calibration`, `lesson`, `foco`, `protocol` |
| two-memories | `figure-two-memories` | `foco`, `taxonomy`, `subcategory`, `memory`, `factor`, `reasoning` |
| inference | `figure-inference` | `memory`, `factor`, `signal`, `reasoning`, `agent`, `trajectory`, `probability`, `protocol` |
| update | `figure-update` | `protocol`, `outcome`, `trajectory`, `retrospective`, `diagnosis`, `aggregation`, `revision`, `memory` |
| evidence | `figure-evidence` | `probability`, `brier`, `confidence`, `ece`, `calibration`, `comparison`, `base`, `static`, `ablation`, `table1-result`, `table3-ablation` |
| reproduction | `figure-reproduction` | `config`, `protocol`, `comparison`, `base`, `static`, `ablation` |

每个 part 的 `source`、`sourceKind` 和 `atomId` 从对应 atom 继承；模块加载时会拒绝未知 atom。每个 part 的 `edgeIds` 也会解析到已有 canonical edge，并检查至少有一个端点是该 part 的 atom。

## 图内含义与讲解边界

- `probability` 把待预测问题、Agent、完整概率分布和结果前时间协议排成输入—输出讲解顺序；70%/30% 在图中明确标记为“讲解例”，不是论文实验值。
- `signal-confidence` 用 10 个点展示 7 个命中约等于 70% 的校准讲解例；点列表达信心与实际命中率的对应关系，不是运行结果。
- `memory-problem` 把一次结果记录画成“看到的信号”和“实际结果”两路，再抽取证据检查与信心控制两类原则；没有在该步骤提前引入 F/R 记忆组件。
- `two-memories` 用带页签的文件夹和目录树解释分类索引，并在同一子类别下画出成对的 F/R 手册。F 手册内部显示放大镜、信号、证据、误用和检查清单；R 手册内部显示证据强弱刻度、冲突/缺失和信心区间。文件夹与“美国总统选举”均标为讲解例，不能读作论文 UI 或完整数据标签。
- `inference` 把双记忆分为“看什么”和“信多少”两路，经 Agent 形成结果前的预测轨迹和概率分布。
- `update` 保留结果揭晓闸门，把预测轨迹和复盘轨迹对照后送入诊断、聚合、局部修订，再写回未来记忆；结果后信息不回填当前预测。
- `evidence` 把 Brier 的完整分布平方误差、ECE 的最大信心分箱匹配、同条件比较、Table 1 和 Table 3 放在同一评价视角中。Table 1/3 卡片均明确写出 `GPT-5-mini` 与 `FutureX` 条件。
- `reproduction` 把 BASE、FoCo (Static) 和 F/R 消融画成并列实验臂，并在每条臂内显示 F/R 与更新开关；开关是比较设计的解释，不代表本机已经执行复现。

## 证据数值来源

模块没有复制或修改实验数组。Table 1 从已有 `results` 中筛选 `configId === "gpt-futurex"` 的 `BASE`、`FoCo (Static)`、`FoCo` 三行，渲染：

- BASE：Brier `0.241`，ECE `0.263`
- FoCo (Static)：Brier `0.203`，ECE `0.219`
- FoCo：Brier `0.187`，ECE `0.195`

Table 3 从已有 `ablation` 数组按周取均值，渲染：

- BASE：Brier `0.241`，ECE `0.263`
- FoCo w/o factor：Brier `0.207`，ECE `0.209`
- FoCo w/o reasoning：Brier `0.205`，ECE `0.220`
- FoCo：Brier `0.187`，ECE `0.195`

这些是已有来源数组对应的 Table 1/Table 3 口径，不是本机复现实验，也不支持把 F/R 差异解释成可相加的独立因果收益。

## 连接线、SVG 与可访问性

所有图内连接线都带 `data-figure-relation="illustrative"`，只表达当前布局的讲解关系，不新增 canonical relation。证据图的评价/支撑连接使用无箭头 `relationLine()`，避免把与 canonical edge 相反的排布方向误读成因果方向。每个 SVG 的 marker 使用 figure 私有 ID（例如 `figure-evidence-arrow`），避免同一页面多个 SVG 的 marker ID 冲突。

`renderFigure()` 输出统一的 `figure-scroll`、隐藏的 `figure-reading` 和 `figcaption`。SVG 根节点使用 `role="group"` 并通过 `aria-labelledby` 绑定 `title`/`desc`；每个 figure part 对应一个带真实 atom ID、`role="button"`、`tabindex="0"` 和部件说明的 `<g>`。模块不使用 `foreignObject` 或网络素材，静态检查中所有显式文字字号至少为 15px。

## 静态验证与剩余验收边界

本轮已通过：

- `node --check plugins/agent-visual-canvas/scripts/knowledge-concept-figures.mjs`
- 8 figures、53 parts；step 顺序和 `figureById`/`figureByStepId` 覆盖正确
- atom、source/sourceKind、edge 端点、viewBox 边界和 part box 不重叠检查
- wrapper、`figure-scroll`、`figure-reading`、SVG `title`/`desc`、根 `role=group`、marker namespace、interactive part 数量检查
- 最小字号 15px、evidence `0.187`、`GPT-5-mini`/`FutureX` 条件标签、probability 70%/30% 讲解标记和 two-memories 讲解例检查

该审计是源模块和生成字符串的静态证据，不替代 root 对实际构建页面的浏览器验收。最终应以 root 重建后的 8 图截图、文字包围盒、键盘可访问树和图内联动回归为准。
