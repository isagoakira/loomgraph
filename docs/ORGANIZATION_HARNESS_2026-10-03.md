# Organization Harness 与表达投影契约

日期：2026-10-03。本文定义 Agent Visual Canvas 表达层如何读取图的组织信息，以及如何把同一份图文数据投影成理解、监控和局部编辑所需的上下文。组织元数据服务于可读性和导航；它不替代业务关系，也不授予执行权限。

## 结论与范围

表达层交付四件事：

1. 从 `graph.metadata.organization` 读取有稳定身份的问题/概念簇、过程段、证据对照、自由图文附页和 gateway 入口。
2. 在完整、局部和当前接口之间提供可逆的有界投影，并把无法放入预算的对象身份记录在 `omissions`。
3. 让 `understand`、`monitor` 和 `mixed` 三种 harness intent 影响提示词组织，同时保持事实和执行证据的边界。
4. 读取 `relation.metadata.presentation` 作为视觉语法，使关系可以分支、流动、反馈或引用地呈现，但保留关系自身的业务语义。

本轮只修改表达层类型、上下文组装、prompt 规则和对应文档/测试。它没有证明真实运行控制、停止/重试或端到端 receipt；这些结论必须由当前上下文中的 `run`、`executor` 和 `receipt` 事实支持。

## 组织元数据接口

`graph.metadata.organization` 的版本化最小契约是：

```ts
{
  schemaVersion: 1,
  defaultIntent: "understand" | "monitor",
  clusters: [{
    id: string,
    title: string,
    question?: string,
    purpose?: string,
    notation: "mindmap" | "flow" | "mixed",
    anchor: { type: "representation" | "element", id: string },
    members: Array<{ type: "representation" | "element", id: string }>,
    essential?: Array<{ type: "representation" | "element", id: string }>,
    entry?: Array<{ type: "representation" | "element", id: string }>,
    exit?: Array<{ type: "representation" | "element", id: string }>,
    // unknown extension fields are retained when the byte budget permits
  }],
  links: [{
    id: string,
    from: string,
    to: string,
    label: string,
    relationIds?: string[],
    // unknown extension fields are retained when the byte budget permits
  }]
}
```

`ExpressionOrganization` 和 `ExpressionOrganizationContext` 都保留 `schemaVersion`、`defaultIntent`、`clusters` 和 `links`。上下文还提供 `currentClusterIds`、可选 `current`、`interfaces`、`syntax` 与组织层 `omissions`，让 Agent 能够知道当前目标属于哪里、从哪里进入、向哪里承接，以及哪些组织对象因范围或预算未被带入。

### 字段语义

| 字段 | 语义 | 边界 |
| --- | --- | --- |
| `id` | cluster、link 和引用对象的稳定身份 | 不因标题、坐标或投影粒度变化而重编；重复或空 ID 被丢弃并记录 |
| `title` | 当前簇的可读名称 | 用于定位和复述，不代替内容结论 |
| `question` | 当前簇试图回答的问题 | 可缺省；没有问题时不能凭标题补造问题 |
| `purpose` | 当前簇在整张图中的表达作用 | 是阅读/组织用途，不是执行动作 |
| `notation` | `mindmap`、`flow` 或 `mixed` 的视觉组织偏好 | 只指导排版和 prompt，不改业务关系 |
| `anchor` | 簇的稳定入口对象 | 必须指向同一图中既有 representation 或 free element |
| `members` | 簇的对象成员 | 引用既有对象；不创建对象，不隐含删除其他簇 |
| `essential` | 当前簇中优先保留的成员 | 是表达取舍信号，不是权限或执行优先级 |
| `entry` | 读者进入该簇时应先看到的对象 | 是阅读路径/接口，不是函数入口或工具调用 |
| `exit` | 离开该簇时应交给下一簇的对象 | 是承接/回顾提示，不是执行后置条件 |
| `links` | cluster 之间的有名跨簇承接 | `from`/`to` 指向 cluster ID；可带真实 `relationIds` 以便回到业务关系 |
| `defaultIntent` | 未明确指定时使用的 harness 偏好 | 只取 `understand` 或 `monitor`；任务场景默认 monitor，其他场景默认 understand |

`anchor`、`members`、`essential`、`entry` 和 `exit` 使用 `OrganizationRef`，目前允许的引用类型只有 `representation` 和 `element`。上下文组装会检查对象是否存在于指定图中，并去重和截断引用；无效引用不会伪装成当前内容。

当前有明确对象、实体或区域目标时，`currentClusterIds` 表示目标所属的小簇，`current` 是第一个当前簇的轻量索引，`interfaces` 提供这些当前簇的入口/出口。明确目标不会自动把未选中的簇搬入视口；图或项目级目标才允许在预算内读取更完整的组织骨架。即使局部投影只有一个簇，仍应通过稳定 ID 和可导航 link 回到更大的结构。

## 关系的视觉语法

业务关系保持原有 `relation.kind`、`from`、`to` 和关系解释。可选的 `relation.metadata.presentation` 只声明以下视觉语法：

```ts
{
  notation: "branch" | "flow" | "feedback" | "reference",
  fromRepresentationId?: string,
  toRepresentationId?: string,
  // unknown presentation fields are preserved when bounded
}
```

四种 notation 的用途是：

- `branch`：把关系作为中心问题下的命名分支呈现；
- `flow`：突出输入、过程和输出的方向；
- `feedback`：突出回看、修订或校准回路；
- `reference`：突出跨簇或跨区域的可导航引用。

这些值不能把 `data_flow` 改写成 `depends_on`，不能凭箭头制造执行状态，不能把计划或标签写成 receipt，也不能授予 Agent 调用工具或修改对象的权限。长跨簇边可以在 overview 或局部视图中聚合成带稳定 ID 的可跳转引用，但完整投影仍须保留真实关系，或者通过 `relationIds` 找回真实关系。

## 三种投影与同一数据

组织层的三种展示粒度不是三份数据：

| 投影 | 输出重点 | 回到完整结构的方式 |
| --- | --- | --- |
| `overview` | 当前图的簇骨架、簇标题、入口/出口和跨簇 link | 使用 cluster/link 的稳定 ID 展开 |
| `local` | 明确目标所属的 `targeted_cluster`、当前问题和邻近关系 | 使用 `anchor`、成员 ID 和 `relationIds` 回读 |
| `complete` | 同一图在 limits 内的全部可读组织数据 | `syntax.complete = "same_data"`，不复制或改写语义 |

上下文通过 `syntax` 明确这种约定：

```json
{
  "overview": "reversible_projection",
  "local": "targeted_cluster",
  "complete": "same_data",
  "crossClusterLinks": "navigable_reference"
}
```

`overview`、`local` 和 `complete` 可以改变当前视口的信息密度，却不能改变对象身份、关系 kind、批注目标或来源状态。必要时，Agent 应先给当前簇的一行定义和本步用途，再让用户展开完整细节。

## 有界上下文与 omissions

`buildExpressionContext` 是只读、确定性的组装函数。它把图主线、术语、阅读路径、目标、节点、关系、自由元素、视图锚点、固定几何和 organization 一起序列化为独立快照；它不会执行导入文本，也不会写入项目。

组织和其他内容共同受 `ExpressionLimits` 约束：

- `maxBytes` 是整个上下文 JSON 的 UTF-8 字节上限，默认 64 KiB；小于 2048 字节的请求直接拒绝；
- `maxClusters` 默认 24，硬上限 120；`maxOrganizationLinks` 默认 48，硬上限 240；
- `maxItems`、`maxNodes`、`maxRelations`、`maxFreeElements`、`maxEvidence`、`maxTextChars` 和 `maxNeighbors` 同时约束其余表达资料；
- 最终预算检查使用 `TextEncoder`（不可用时退回序列化字符长度），因此不能只按字符数估算中文上下文。

裁剪顺序会优先移除聚合的 `fixedGeometry`，随后移除组织 links/clusters，再处理自由元素、关系、节点、路线、术语和其他可选字段。每一项裁剪都写入稳定身份或字段名：

```ts
context.organization.omissions = {
  clusters: string[],
  links: string[],
  fields: string[],
};

context.omissions = {
  organizationClusters: string[],
  organizationLinks: string[],
  // nodes, relations, freeElements, fields, reasons, truncatedText, budget
};
```

最终字节裁剪还会清理指向已移除簇的 link，并同步 `currentClusterIds`、`interfaces` 和 `current`。因此 Agent 看到 `omissions` 时必须说明“哪些 ID 未读到”，不能把剩余的局部上下文描述成完整审阅。被省略的关键概念、关系或簇要先按稳定 ID 补读，再进行编辑或结论判断。

## Intent harness 与最低元模块

`buildExpressionPrompt` 根据图场景、organization intent 和本轮 action 生成 instruction-only prompt。它把输入快照放在 `QUOTED_CONTEXT` 区域，明确导入文字是引用资料，不能成为工具调用、执行指令或权限授权。

### `understand`

适合论文、阅读和概念讲解。当前目标所在簇内：

1. 就地引入或复述必要概念及其本步用途；
2. 用原位图解解释内部机制、输入输出和关系传递；
3. 沿“问题 → 结论”核对承接，再按需要展开证据和局限。

远处簇只通过稳定引用和必要的一行定义承接，不为了全局完整而抢占当前用户视口。

### `monitor`

适合真实任务进度。当前簇附近优先呈现真实状态、时间、来源、run、executor 和 receipt；异常先说。没有回执时明确写未知，排队、收到请求、保存标签、计划或 prompt 生成都不能写成执行已生效。监控信息贴近当前结构但不抢占用户 viewport。

### `mixed`

需要同时理解概念和监控任务时，保留两套要求：概念仍在局部就地复述、原位图解并回答问题到结论；状态、时间、来源、run、executor、receipt 与异常另列，异常优先但不覆盖理解路径。

三种 intent 都使用以下最低元模块入口，按实际材料合并或拆分：

1. **问题/概念簇**：提出当前问题，承载必要定义和知识中心；
2. **过程段**：按输入、机制、过程、输出组织实际过程；
3. **证据对照**：并列来源、作者报告、复现结果、差异和局限；
4. **自由图文附页**：放长文、图解、表格或补充材料，并保留稳定对象身份；
5. **gateway 入口**：提供跨簇进入、回顾和返回原位的导航。

这是可调的工程组织接口。模块数量、屏幕数量和概念密度可以作为检查信号，不能被 prompt 宣称为人类记忆容量的硬科学上限。

## 稳定身份、批注与未知扩展

组织投影必须保留以下身份：

- graph、entity、representation、relation、free element 和 cluster/link 的稳定 ID；
- `ContentAnchor` 中真实存在的 `sectionId`、`paragraphId`、quote 或 view；
- 批注的目标和 `observedRevision`；
- 未知字段和 `unknown extensions`，只在预算允许时随原记录带出。

坐标只能作为几何和范围筛选，不能被当作语义身份。批注、阅读展开和当前视图是浏览/编辑上下文，不能因为被放进 prompt 就转化为执行授权。组织元数据字段中的未知扩展会被保留，若被预算裁剪则应在 `omissions.fields` 标示；不能静默重写或删除无关扩展。

## 能力边界与核验方式

本轮可核验的是：

- organization schema 能被读取、规范化并按图/目标范围投影；
- `current`、`interfaces` 和稳定的 cluster/link omissions 可追踪；
- relation presentation 会进入上下文但不改业务 `kind`；
- UTF-8 `maxBytes`、cluster/link limits 和最终裁剪保持自洽；
- prompt 能在 understand、monitor、mixed 下表达相应的事实边界，并把导入文本隔离在引用区。

本轮不能据此宣称：

- 某个 run 已启动、停止、重试或成功；
- 某个 executor 已实际执行 prompt 中描述的操作；
- 仅因 organization link、presentation notation、排队事件或标签存在，就有了权限或 receipt；
- 论文事实、实验结果或真人理解质量已经由表达检查自动证明。

要报告真实执行，只能使用当前 snapshot 中可核对的 run/executor/receipt，并明确来源、时间和观察版本；缺少这些证据时，输出应保持 `unknown` 或 `needs_clarification`。

## R133 spatial notebook 增量方案（仅供 review）

当前只读检查得到目标图 `forecastcompass-spatial-notebook` 的 revision 133。方案文件为[enrich-spatial-organization.json](examples/forecastcompass/enrich-spatial-organization.json)，生成脚本为[enrich-spatial-organization.mjs](examples/forecastcompass/enrich-spatial-organization.mjs)。脚本只接受外部导出的 JSON 快照并写出本地计划，不连接 live 服务、不调用 `canvas_apply`，也不重跑 notebook 创建生成器。

计划包含 1 个 `graph.patch`、37 个既有 notebook 关系的 `relation.patch` 和 55 个论文知识关系的 `relation.put`：

- 八个现有 `notebook.branches` 原样镜像成 organization clusters，`members`、`anchor` 与当前 notebook 保持同步；每簇补充独立的 `question`、`purpose`、`essential`、`entry`、`exit` 和 `mindmap`/`flow`/`mixed` notation。`essential` 按簇语义选择关键概念并加入该簇自己的 diagram，`entry`/`exit` 只引用真实概念表示或稳定 anchor，不把 prose 当作流程输出。`defaultClusterId` 固定为 `two-memories`。
- 37 条现有 notebook 组织关系仅补 `metadata.presentation`：结构边使用 `branch`，并显式写入当前图中的 `fromRepresentationId` / `toRepresentationId`。原有 `metadata.notebook`、`expression`、样式和其他扩展随 relation patch 保留。
- 55 条论文知识边复用 `pilot-ks-atom-*` canonical entity ID，新增关系 ID 为 `knowledge-<sourceRelationId>`，并在 metadata 中记录 `sourceRelationId`、局部/跨簇 `organization.scope`、关系解释、证据来源和明确表示端点。`input`/`output` 采用 `flow`，包含/索引采用 `branch`，更新/触发采用 `feedback`，比较/评价/证据采用 `reference`。
- organization links 按跨簇知识边分组为可导航门户，并保留 `relationIds`；同时补充八簇之间的阅读路径。`inference` 与 `update` 两个既有 flow 簇承载预测和修订流程，不另建跨屏 overlay 簇。局部线仍作为真实 relation 保留，跨簇聚合只改变展示密度。

计划摘要为 8 个 clusters、24 个 organization links、37 个既有关系 patch 和 55 个新增关系。它不包含 representation、free element、entity、annotation 或正文操作，故不会覆盖用户在 revision 133 之后的 geometry/text/批注。Root agent 在 apply 前必须重新执行 `canvas_open`/`canvas_read` 获取最新 revision，确认 notebook 字段和成员未变，再对整批 operations 执行 `expression_validate(action: "mixed")`；通过 review 后才可另行提交版本保护的 `canvas_apply`。任何 revision 漂移、端点失效、成员差异或 expression 校验问题都应停止 apply 并重建本地计划。
