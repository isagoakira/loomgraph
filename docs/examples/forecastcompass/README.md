# ForecastCompass 表达样例

当前入口是 [knowledge-structure-pilot.html](knowledge-structure-pilot.html#step-two-memories)：连续讲解主干、八张可交互的概念 SVG、有中心和分支的知识卡片、带语义的交叉关系和原位概念回顾。

图形部件能就地显示概念含义并联动卡片；独立图解在 [concept-figures/](concept-figures/)。当前[图解验收](../../CONCEPT_DIAGRAMS_ACCEPTANCE_2026-10-03.md)记录 36/36 浏览器检查、R115 本地图片与八步 24KB MCP 往返。样例交互与通用原生渲染器的边界分别记录。

前版 [reading-flow-pilot.html](reading-flow-pilot.html) 保留。论文数值和配置来自同一已核验 reading-flow 数据模块，新版以引用复用；讲解例与实验结果分开。

完整说明见[本轮验收](../../KNOWLEDGE_STRUCTURE_MEMORY_ACCEPTANCE_2026-10-03.md)和[实施方案](../../KNOWLEDGE_STRUCTURE_MEMORY_PLAN_2026-10-03.md)。当前知识数据在 knowledge-structure-pilot-data.mjs；可查看 knowledge-structure-contexts.json 了解每一步传递给 Agent 的定义、回顾和前后承接。

从插件根目录运行 node scripts/build-knowledge-structure-pilot.mjs 可重建新版派生文件，不改前版 HTML。真实浏览器验收脚本为 scripts/verify-knowledge-structure-pilot.mjs，调用时必须传入正在使用的 Ego TaskSpace id，不能重新接管已结束的空间。

组织升级候选生成器为 [upgrade-spatial-organization.mjs](upgrade-spatial-organization.mjs)。它只接收离线 `canvas_open/canvas_read` JSON snapshot，输出 `forecastcompass-organization-upgrade.json` 中的单个 `graph.patch` 候选，补齐 cluster 的 `parentId/order` 和 placement 的唯一 `layoutOwnerByRef`，保留 legacy notebook、文本框、图解、原图资源和历史字段；不会连接 live 或直接应用变更。root 可将输出作为 candidate/preflight，再重新读取当前 revision 并通过 `expression_validate` 后决定是否应用。
