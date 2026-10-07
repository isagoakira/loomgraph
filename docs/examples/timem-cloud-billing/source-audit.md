# TiMEM Cloud 图谱计费源码审计

审计日期：2026-10-06  
审计仓库：`/Users/Zhuanz1/Desktop/file/智悦/TiMEM/timem-platform-backend`  
源码 HEAD：`fb05edbeea8fdf6034adb8b8af1a6aad7b907d72`  
范围：图谱记忆、表、文档入图；`/graph/search`；`/graph/qa`；钱包、资源包、失败账单与计费幂等。  
口径：这是太忆云图谱的源码审计，使用 `memory_add` / `memory_search` 资源单位。不能把这些单位直接换算成太忆空间积分，也不能把源码默认价当作生产现价。

## 先给结论

- 三种入图入口（memory/table/document）都返回 `202`，没有 HTTP 阶段的 `@charge_endpoint`。任务真正结束时，`completed` 或 `completed_with_errors` 才具备计费资格；`failed`、`empty`、`skipped` 不具备资格。
- 当前默认 `GRAPH_INGEST_BILLING_ENABLED=False`。终态只写 `stats.billing.would_charge=true, units=1`，不扣钱包。
- 如果打开开关，真实扣费并不是 `would_charge.units=1`：代码传 `level=L3, source=graph_ingest`；当前 YAML 没有该 source 覆盖，因此按 `by_level.L3=3`，即每个成功终态任务扣 **3 个 `memory_add` 单位**。无论是记忆、表还是文档，当前都按任务一次扣 3；不按 memory_ids 数量、表行数或文档块数展开。
- `/graph/search` 和 `/graph/qa` 各自装饰一次 `memory.search`，当前实际收费各 1 个 `memory_search` 单位。QA 内部直接调用 `search_graph_hit`，不会再经过装饰器，所以 QA 内部检索不双扣。客户端先调用 search 再调用 QA，才是两次 HTTP 请求、两次收费。
- 入图扣费顺序是“业务写图完成 → 更新 Redis 任务终态 → 扣费”。图数据、Redis 任务和财务数据库不在一个事务中；扣费失败不会自动回滚已写入的 Neo4j 图数据。成功扣费后，usage 统计若失败还会释放 Redis 幂等键，重试存在重复扣费风险。
- 钱包路径先消费资源包，再消费赠金，再消费现金余额。预检发现资源包不足且钱包不足时，写一条 `status=failed,total_amount=0` 的失败账单并返回 402，不动钱包、不写成功交易。

证据等级：`[SRC]` 为当前源码/仓库配置直接证据；`[ENV]` 为部署运行时需要确认的值；`[PLAN]` 为候选定价或成本底稿，不代表当前生产行为。

## 调用与计费流程

```mermaid
flowchart TD
  A[POST /graph/ingest/memory|table|document] --> B[创建 Redis 任务]
  B --> C[HTTP 202 pending]
  C --> D[后台写图/抽取/合并]
  D --> E{任务终态}
  E -->|failed / empty / skipped| F[写 would_charge=false, units=0]
  E -->|completed / completed_with_errors| G[写 would_charge=true, units=1]
  G --> H{GRAPH_INGEST_BILLING_ENABLED?}
  H -->|否，默认| I[仅 dry-run，不扣款]
  H -->|是| J[charge_memory_write_once L3 + graph_ingest]
  J --> K[真实 amount = by_source → by_level → default]
  K --> L[当前回退 L3 = 3 memory_add]

  S[POST /graph/search] --> S1[charge_endpoint memory.search 预检]
  S1 --> S2[执行图检索]
  S2 -->|成功 2xx 非 202| S3[扣 1 memory_search]
  S2 -->|异常/4xx/5xx| S4[不执行成功扣款]

  Q[POST /graph/qa] --> Q1[charge_endpoint memory.search 预检]
  Q1 --> Q2[answer_graph_question]
  Q2 --> Q3[内部 search_graph_hit：无第二装饰器]
  Q3 --> Q4{生成/空图结果}
  Q4 -->|200，包括空图| Q5[扣 1 memory_search]
  Q4 -->|GraphQaError → 502| Q6[不执行成功扣款]
```

入图入口的 `202` 与无装饰器证据见 `app/graph_management/api/ingest_api.py:76-100,103-132,177-203`；入图结算见 `app/graph_management/services/graph_ingest_service.py:146-170`。Search/QA 的装饰器见 `app/graph_management/api/graph_api.py:381-447`，QA 内部调用见 `app/graph_management/services/graph_qa.py:62-92`。

## 三种入图的 charge_units

| 入口 | 任务终态 | 返回/展示口径 | 开关关闭（当前默认） | 开关打开后的真实量 | 计量粒度 |
|---|---|---:|---:|---:|---|
| `/graph/ingest/memory` | `completed` / `completed_with_errors` | `would_charge=true, units=1` | 0 | 3 `memory_add` | 每个任务 |
| `/graph/ingest/table` | `completed` | `would_charge=true, units=1` | 0 | 3 `memory_add` | 每个任务 |
| `/graph/ingest/document` | `completed` / `completed_with_errors` | `would_charge=true, units=1` | 0 | 3 `memory_add` | 每个任务 |
| 任一入口 | `failed` / `empty` / `skipped` | `would_charge=false, units=0` | 0 | 0 | 不计费 |

“展示口径”和“真实量”必须分开写：`app/billing/graph_ingest_billing.py:21-35` 固定写 `units=1`，而 `:39-62` 真实调用传 `L3 + graph_ingest`；`app/billing/charge_config.py:214-244` 明确解析顺序是 `by_source → by_level → default`。当前 `config/timem/billing_charges.yaml:1-27` 没有 `graph_ingest`，只有 `L3: 3`，所以得到 3。文件中的“yaml amount stays 0”注释与实际回退逻辑不一致。

文档即使有多个 chunk，当前计费代码也不会把 chunk 数传入 amount；文档的块数只影响业务处理。表同理，行数不是当前 billing amount 的输入。文档最多 120 chunks、并发默认 4/上限 8，表最多 10 行，这些是业务硬上限，不是当前客户计费公式。

## Search、QA 与扣费时机

`charge_endpoint` 的实际顺序是：资源预检 → 调用业务函数 → 成功的 2xx 且不是 202 时扣款。代码见 `app/billing/decorators.py:225-301`。因此：

| 请求 | 预检 | 成功扣款 | 失败结果 |
|---|---|---:|---|
| `/graph/search` | `memory_search`，当前 1 | 1 | 业务异常/非成功响应不执行成功扣款 |
| `/graph/qa`，有图且生成成功 | `memory_search`，当前 1 | 1 | 同上 |
| `/graph/qa`，空图 | `memory_search`，当前 1 | 1（返回 200 的空图答案） | 不是“零结果免单” |
| `/graph/qa`，LLM 生成异常 | 预检通过 | 0 | `GraphQaError` 转 502 |

QA 的 `answer_graph_question` 先执行 `search_graph_hit`，空图直接返回；有图才调用 LLM，LLM 最大 512 tokens 且 `max_retries=0`（`app/graph_management/services/graph_qa.py:74-119`）。内部 search 是函数调用，不是 `/graph/search` HTTP 请求，也没有第二个 `@charge_endpoint`。

当前 graph search/QA 使用 `get_memory_search_charge()`，按 YAML `memory_search.default_amount=1`（`app/billing/charge_config.py:112-117`、`config/timem/billing_charges.yaml:29-40`）。代码中另有 rethink block 计费函数，但本图谱路由没有把它接入本次 charge path，不能据此增加 graph search/QA 的收费。

## 资源包、赠金、现金与 402

对一次需要 `required` 个资源单位的成功扣费，`charge_resource_or_balance` 执行：

1. 查询当前有效资源包额度，`package_amount=min(available, required)`，`balance_usage=required-package_amount`。
2. 只对 `balance_usage` 按当前套餐 `price_per_add` 或 `price_per_search` 计算钱包金额。
3. 先消费资源包（`_consume_package_quota`）；资源包按套餐优先级、过期时间、创建时间选择。
4. 现金金额中先扣 `balance_gift_credits`，再扣 `balance_credits`。
5. 写 debit transaction 和 `FinanceBill(status=success)`，提交财务事务。

代码证据：`app/console/service/finance_service.py:1552-1655`、资源包选择 `:1865-1920`。因此“扣 3 个 `memory_add`”表示 3 个资源单位；若资源包覆盖其中 3 个，钱包现金新增扣减是 0，不能直接把 3 单位说成 3 分收入。

预检路径 `ensure_charge_available` 先计算资源包不足部分的现金需求；钱包总额不足时调用 `record_failed_bill`，该旁路账单为 `status=failed,total_amount=0,usage_amount=0`，不写 `BillingTransaction`、不动钱包，然后返回 HTTP 402。证据：`app/console/service/finance_service.py:1441-1505,1507-1550`。实际扣费函数也再次检查余额，避免预检与扣费之间余额变化导致负扣款（`:1575-1597`）。

## 失败、回滚与幂等边界

### 入图

入图 worker 先执行图写入，然后 `_finish_ingest_task` 先更新 Redis 任务状态与 stats，最后才调用真实扣费（`graph_ingest_service.py:146-170`）。因此不存在 Neo4j、Redis、财务数据库的跨系统事务：

- 图写入成功但扣费因余额不足失败：图数据不会自动删除；任务可能随后被外层异常处理改为 `failed`，同时只保留失败账单。
- 财务扣费在 `charge_resource_or_balance` 内提交后，usage 统计再失败：财务扣款可能已经持久化，`charge_memory_write_once` 却释放 Redis 幂等键（`app/billing/memory_write_billing.py:122-149`）；重试理论上可能再次扣款。
- Redis 幂等 claim 失败时 fail-closed，任务计费抛错；这也不回滚已经完成的图写入。
- `graph_ingest:task:{task_id}` 是一次任务的逻辑幂等键，实际 Redis 键还加 `billing:charged:` 前缀。计费幂等 TTL 默认 604800 秒，代码最低钳制为 3600 秒（`memory_write_billing.py:30-78`、`charge_config.py:97-101`）。图任务状态和入图请求幂等 TTL 默认 86400 秒（`graph_ingest_store.py:15-23`）。

### Search / QA

Search/QA 本身是读操作；成功扣款发生在业务函数返回后。余额预检失败时不会调用图检索/QA，而是写失败账单并返回 402。QA 生成失败转 502，装饰器没有走成功扣款分支。这里没有需要回滚的图写入，但预检失败账单是独立会话提交的旁路记录。

## 当前源码、部署未知与候选方案

| 项目 | 当前源码可确认 `[SRC]` | 部署仍需确认 `[ENV]` | 候选方案 `[PLAN]` |
|---|---|---|---|
| 入图开关 | `GRAPH_INGEST_BILLING_ENABLED=False` | 生产环境变量是否覆盖默认值 | 先 dry-run 回放真实用量，再启用 |
| 入图真实量 | 开关开启时 L3 → 3 `memory_add`/任务 | YAML 是否被挂载替换、数据库套餐是否覆盖 | 按实际块/段/行与 Token 计价 |
| Search/QA | 各 1 `memory_search`；QA含内部检索 | 生产 YAML、账户订阅、钱包余额 | 最终候选建议 Search/QA 各 0.01 元（1 分）；旧草案 QA 2 分已被完整推导版替代 |
| 钱包单价 | 无计划时运行时回退 `price_per_add/search=1` | 实际 active plan、币制及数据库套餐 | 候选文档按人民币分讨论，需独立确认 |
| 模型/厂商费 | 源码有 qwen/通用 LLM 路由分支 | 实际 provider、模型版本、Token 账单 | 成本底稿的 Token 单价与 4 倍只是规划假设 |

候选文档明确声明未修改生产配置，见 `成本方案测算/图谱计价模型_2026-10-02/太忆云图谱计费推导.md:1-11`；其最终 Search/QA 建议是各 1 分/次，且 QA 包含内部检索，见 `:190-200`。旧版 `太忆云图谱定价草案_2026-10-02.md:1-3,19-27` 中的 QA 2 分已被完整推导版替代，不应再作为当前候选价格。候选方案仍不能反推当前源码行为。

## 硬上限与尚未闭合的证据

| 范围 | 当前硬上限/默认值 | 证据 |
|---|---|---|
| 文档 | 120 chunks；并发默认 4、上限 8；抽取单块超时 90 秒 | `schemas/document_ingest.py:8-24`；`graph_ingest_service.py:1149-1157` |
| 表 | 单次最多 10 行；推断样本最多 10 行 | `schemas/table_ingest.py:9-10,72-86` |
| Search/QA | query/question 最长 400 字符；limit 1–50；hops 仅 1 | `schemas/graph_search.py:17-35,48-102` |
| QA 上下文 | context 2500 字符、history 800、最多 10 facts；输出最多 512 tokens；LLM 不重试 | `services/graph_context.py:13-20`；`services/graph_qa.py:25-27,94-119` |
| 任务 | Redis task/idempotency 默认 TTL 86400 秒 | `services/graph_ingest_store.py:15-23` |
| 计费幂等 | YAML 604800 秒，代码最低 3600 秒 | `billing_charges.yaml:27`；`billing/charge_config.py:97-101` |

仍需部署侧闭合：生产环境是否开启入图扣费、实际挂载的 billing YAML、实际 active plan 与钱包币制、LLM provider/model/price version、Neo4j 与云盘固定成本、以及扣费成功后 usage 失败的重试策略。源码审计不能把这些未知项填成现价或生产成本。

## 一句话讲解稿

“现在图谱入图只是异步受理，默认只在任务结束记录 `would_charge`；如果打开开关，记忆、表、文档每个成功任务统一按 L3 配置扣 3 个 `memory_add`。Search 和 QA 各扣 1 次 `memory_search`，QA 自带的内部检索不重复扣；扣钱时先用资源包，再用赠金，最后用现金。图写入和扣费不是一个事务，余额失败不会扣钱，但已写图不会自动回滚。”
