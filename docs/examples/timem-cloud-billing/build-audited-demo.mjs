import { graphIds, node, edge, note, graph, saveCandidate, code, api, backend } from './build-flow-demo.mjs';
const I=graphIds.ingest;
node(I,'write','01 · 先处理并写入图谱','文档按块、L3按段、表按变化行处理；这是工作量，不是当前售价。',0,0,{source:`${backend}/app/graph_management/services/graph_ingest_service.py`,details:['文档最多120块，L3本地拆段；表单请求最多10行。','模型实际用量仍含额外向量、别名、融合与冲突判断；当前计费钩子不按这些Token定价。']});
node(I,'status','02 · 任务状态可计费？','仅 completed 或 completed_with_errors 进入 eligible=true。',480,0,{source:code,role:'decision',details:['failed、cancelled等状态不符合should_bill_graph_ingest。','completed_with_errors也被纳入；这与候选方案“仅成功提交部分结算”不是同一实现。']});
node(I,'skip','当前任务不走入图扣款','不合资格时units=0；已产生的厂商费用仍是平台成本。',480,780,{source:code,details:['这条分支解释计费钩子的eligible判断，不承诺厂商从未收费。','上游部分写入、模型成功后超时等需要成本与任务账本分别核验。']});
node(I,'switch','03 · 真实计费开关打开？','GRAPH_INGEST_BILLING_ENABLED 默认 false。',960,0,{source:code,role:'decision',terms:['would-charge']});
node(I,'shadow-record','关闭：保存 would_charge','eligible任务记units=1、charged=false；钱包不扣。',960,780,{source:code,terms:['would-charge'],details:['units=1是一次合资格任务的模拟标记，不等于一块、一个Token或三分。','任务stats.billing中的charged固定false；不能把这份模拟记录当真实扣款凭证。']});
node(I,'legacy-price','打开：读取现有写入配置','按 source=graph_ingest、level=L3；默认3个memory_add额度单位。',1440,0,{source:`${backend}/config/timem/billing_charges.yaml`,terms:['quota'],details:['YAML默认L3=3，默认写入钱包单价1分/单位；额度耗尽且默认价未改时，回退钱包3分。','这是默认配置路径，不代表现网已打开，也不是每块3分或按实际Token结算。','配置优先级/来源覆盖可改变amount；本轮没有读取生产套餐和开关。']});
node(I,'dedup','04 · 同一任务已认领扣款？','幂等键只在有效期内、且未被异常释放时避免重复收费。',1440,390,{source:`${backend}/app/billing/memory_write_billing.py`,role:'decision',terms:['idempotency'],details:['charge_memory_write_once读取配置后认领幂等键；再次认领失败会跳过。','默认计费幂等TTL为7天；任务/请求状态TTL为1天。只有键仍有效且没有异常释放时，重试或轮询才可依此跳过，不能承诺永久去重。','Redis不可用时认领失败并 fail-closed；不存在本地兜底，也不能把本地重试当成有效去重。']});
node(I,'repeat','重复：在有效键内跳过扣费','同一逻辑任务在幂等键有效且未被释放时不重复收费。',1920,0,{source:`${backend}/app/billing/memory_write_billing.py`,terms:['idempotency'],details:['这条路径只承诺默认7天TTL内的有效幂等键；过期、被释放或换了任务身份后，需要重新核对财务账单。']});
node(I,'debit','新任务：提交财务扣减','先memory_add额度；缺口按套餐单价用赠金，再现金。',1920,390,{source:`${backend}/app/console/service/finance_service.py`,subgraphs:[graphIds.finance],terms:['quota','cloud-money'],details:['实际返回收费amount不回写为任务stats.billing.charged=true。核对真实收费需查财务账单/交易。','入图顺序是图写入 → Redis终态/统计 → 财务扣减；这些步骤不是同一原子事务，扣款失败不承诺回滚此前图写入。','前置校验、余额不足或财务拒绝可能尚未提交扣款；只有财务已提交后才进入下一张“用量统计”卡。']});
node(I,'usage-stats','05 · 财务提交后：写用量统计','财务扣减已提交，再写入任务用量与结算统计。',2400,390,{source:`${backend}/app/billing/memory_write_billing.py`,terms:['idempotency'],details:['财务扣减与用量统计是分开的后置步骤，统计写入失败不能反推出财务扣款一定没有提交。','本卡只描述已提交扣款后的后置路径；前置校验失败或财务拒绝不进入这里。']});
node(I,'usage-failure','统计失败：释放 Redis 认领键','后置统计异常可能释放本次幂等认领，需和财务账单单独对账。',2400,780,{source:`${backend}/app/billing/memory_write_billing.py`,role:'decision',terms:['idempotency'],details:['这条错误支路只适用于“财务已提交、用量统计失败”的组合；不是所有扣款异常都已经提交。','异常处理释放Redis认领键后，原任务的去重保护可能消失；不能用stats.billing.charged字段代替财务账单确认。']});
node(I,'retry-risk','重试：可能再次扣款','认领键释放后，重试可能重新认领并再次进入财务扣减。',1920,780,{source:`${backend}/app/billing/memory_write_billing.py`,role:'risk',terms:['idempotency','cloud-money'],details:['这是需要对账与补偿的真实风险分支，不是每次重试都会重复扣款。','若之前的财务扣款已提交且重试重新获得认领，可能形成重复扣款；有效幂等键仍在且未释放时则走跳过路径。']});
edge(I,'write','status','更新任务状态','_finish_ingest_task先写任务状态和模拟计费stats，再考虑真实扣款。');
edge(I,'status','switch','合资格','completed或completed_with_errors符合当前钩子。','eligible=true');
edge(I,'status','skip','未完成 / 失败','不合资格状态不调用真实扣款。','eligible=false');
edge(I,'switch','shadow-record','false（默认）','默认开关关闭只保留应扣标记。','GRAPH_INGEST_BILLING_ENABLED=false');
edge(I,'switch','legacy-price','true','启用后从普通L3记忆写入计费配置获取amount。','实际部署启用');
edge(I,'legacy-price','dedup','amount>0','实际配置amount为正时认领任务幂等键。','配置可收费');
edge(I,'dedup','repeat','已认领且键有效','只在有效幂等键范围内跳过重复扣费。','有效幂等键');
edge(I,'dedup','debit','首次认领','新任务进入真实财务扣减事务。','认领成功，键未被占用');
edge(I,'debit','usage-stats','财务扣款已提交','提交成功后进入用量统计；未提交的财务异常在此处分支之前结束。','finance commit accepted');
edge(I,'usage-stats','usage-failure','统计失败','财务扣减与用量统计不是一体事务。','usage statistics error');
edge(I,'usage-failure','retry-risk','认领键已释放','下一次重试可能重新获得扣费资格。','post-commit stats failure');
edge(I,'retry-risk','debit','重新认领','可能再次进入财务扣减；是否重复收款需查Finance账单。','retry after release',{feedback:true});
note(I,'ingest-header','当前入图 · 为什么完成写入不等于已扣费',['绿色只代表本地实现已核验。默认为模拟路径；启用开关后的amount=3是默认L3额度，不是已发布图谱Token价。','当前完成状态包括completed_with_errors；部分成功如何按实际用量结算，是候选方案要补的能力。'],0,-240,2300,180);
note(I,'ingest-limit','现有原子性边界',['扣款发生在任务更新之后；图写入、Redis终态/统计、财务扣减不是一个原子事务。','若财务已提交而后置统计失败，认领键可能被释放并导致重试重复扣款风险；这只适用于该特定组合。','真实扣费凭证看财务账单，不看stats.billing.charged；模拟字段在本地实现中固定false。'],1440,1080,860,210);
graph(I,'太忆云 · 入图模拟与真实扣费','按任务完成状态与开关分叉；当前套用L3记忆写入配置，实际Token方案尚未接入，并显式展示后置统计失败的重试风险。','write',[
  {id:'task',title:'写入与状态',question:'业务是否进入可计费状态？',anchor:'write',members:['status','skip']},
  {id:'mode',parent:'task',title:'计费开关',question:'只记应扣还是执行扣款？',anchor:'switch',members:['shadow-record','legacy-price']},
  {id:'charge',parent:'task',title:'任务幂等扣费',question:'本次能否扣、有没有真实凭证？',anchor:'dedup',members:['repeat','debit','usage-stats','usage-failure','retry-risk']}
]);

const Q=graphIds.query;
const decorator=`${backend}/app/billing/decorators.py`;
const finance=`${backend}/app/console/service/finance_service.py`;
node(Q,'external-query','01 · 一次外部 search 或 QA','两个接口都用memory.search，默认消耗1个memory_search单位。',0,0,{source:api,terms:['quota'],details:['/graph/search和/graph/qa各有一次charge_endpoint(memory.search)。','QA直接调用answer_graph_question，内部search_graph_hit不经过外部收费接口，所以不叠扣第二次。']});
node(Q,'precheck','02 · 额度＋钱包够用？','执行查询之前ensure_charge_available只检查，没有预扣款。',480,0,{source:decorator,role:'decision',details:['校验计费账户account_id，不把被查询的subject user_id当钱包所有者。','不足返回402；当前预检查不是候选方案中的预算预留/冻结。']});
node(Q,'execute','03 · 执行查询 / QA','QA先取子图；非空才生成答案，空图也可成功返回。',960,0,{source:api,details:['QA的内部检索不再经过HTTP收费包装器。','当前检索是否向量化由具体实现与可用配置决定；费用用真实usage对账，不能用报告里的短查询均值伪造实际调用。']});
node(Q,'postcheck','04 · 成功后再核验可扣？','2xx且非202才进入同步扣费；执行期间余额可能改变。',1440,0,{source:decorator,role:'decision',details:['成功后第二次ensure_charge_available，防止前次检查后可用余额变化。','后置检查失败时，模型查询可能已经完成并产生厂商成本。','HTTP异常或服务错误不进入成功扣费分支，当前代码记录失败统计。']});
node(Q,'no-balance','初始预检不足：拒绝本次服务','首次额度/钱包检查不足，业务尚未执行。',480,390,{source:finance,details:['这条分支发生在查询或QA执行之前；首次预检不足返回402，不发生本次业务预扣。','当前预检查不是候选方案中的预算预留/冻结；厂商成本需看是否已经进入业务执行。']});
node(Q,'service-failure','业务异常：不走成功扣费','业务抛错不进入成功扣费；失败厂商成本仍需单独记账。',960,390,{source:decorator,details:['HTTP异常或服务错误不进入成功扣费分支，当前代码记录失败统计。','失败响应不等于厂商没有收费；实际成本与客户结算分别对账。']});
node(Q,'post-shortage','后置核验不足：成功后无法结算','业务已返回成功，但后置额度/钱包核验不足。',1440,390,{source:decorator,role:'decision',details:['这条分支发生在业务成功之后；执行期间额度或余额可能改变，后置ensure_charge_available可能返回402。','模型查询可能已经完成并产生厂商成本；不能把后置结算失败说成厂商成本为零。']});
node(Q,'settlement-entry','05 · 进入资源额度与钱包结算','业务成功且后置核验通过，进入资源额度→赠金→现金的结算子图。',1920,0,{source:finance,subgraphs:[graphIds.finance],terms:['quota','cloud-money'],details:['成功出口只把结算阶段交给“太忆云 · 资源额度与钱包”子图。','真实收费看FinanceBill/BillingTransaction，usage统计不是收款凭证；QA内部search_graph_hit不再重复收费。']});
edge(Q,'external-query','precheck','计费账户','先检验账号可用权益和钱包。');
edge(Q,'precheck','execute','够用','首次预检足够后才执行业务。','额度和钱包覆盖');
edge(Q,'precheck','no-balance','不足','首次检查不足返回402，没有预扣发生。','首次预检不足');
edge(Q,'execute','postcheck','成功返回','2xx且非202进入同步结算。','业务成功');
edge(Q,'execute','service-failure','异常','业务抛错时记录失败，不进入成功扣费。','HTTPException / 服务异常');
edge(Q,'postcheck','post-shortage','已不足','业务完成后执行期间额度或余额改变，后置结算不足。','后置检查不足');
edge(Q,'postcheck','settlement-entry','仍够用','业务成功后进入资源额度与钱包结算子图。','后置预检通过');
note(Q,'query-header','当前查询 · 一个外部请求只走一次收费包装',['默认memory_search=1单位，钱包价默认1分/单位。QA内部检索不再次调用收费接口。','流程区分“预检”“业务成功”“实际扣款”和“统计记录”，避免把成功响应等同于已经收款。'],0,-240,2300,180);
graph(Q,'太忆云 · 查询与结算入口','查询先预检、成功后再结算；余额不足按发生阶段分流，成功出口进入资源额度与钱包子图。','external-query',[
  {id:'entry',title:'请求及预检',question:'谁付费、什么时候检查？',anchor:'external-query',members:['precheck','no-balance']},
  {id:'work',parent:'entry',title:'业务完成',question:'失败或空图怎样进入收费条件？',anchor:'execute',members:['postcheck','service-failure','post-shortage']},
  {id:'settle',parent:'entry',title:'成功出口',question:'后置核验通过后进入哪张结算子图？',anchor:'settlement-entry',members:[]}
]);

const F=graphIds.finance;
node(F,'quota-use','01 · 先抵扣对应资源额度','先用对应资源权益；缺口×该资源的套餐单价。',0,0,{source:finance,terms:['quota','cloud-money'],details:['检索/QA默认需要1个memory_search；已启用的入图路径当前默认需要3个memory_add。','缺口按price_per_search或price_per_add结算，默认钱包单价1分/单位；生产套餐可能覆盖。','额度足够时total_amount=0，本次钱包不出钱；资源权益消耗不等于新增现金收入。']});
node(F,'wallet-use','02 · 额度缺口：赠金 → 现金','不足部分按套餐价格扣钱包；先赠金，剩余再现金。',480,0,{source:finance,terms:['cloud-money'],details:['一次charge_resource_or_balance会再次核对钱包合计，足够才消费额度和钱包。','额度不足时进入赠金与现金余额结算；余额不足走下方失败分支。']});
node(F,'receipt','03 · 账单与统计分别记录','真实收费看FinanceBill/BillingTransaction，usage统计不是收款凭证。',960,0,{source:finance,details:['财务账单标记resource_type、usage_amount、unit_price、总额及扣减来源。','同步查询统计失败另有容错；入图后置统计异常可能释放幂等键，见入图子图。','不能把调用次数当现金收入或真实厂商成本。']});
node(F,'finance-shortage','钱包不足：失败账单与402','财务事务再次核对后仍不足，记录失败账单并返回402。',480,390,{source:finance,role:'decision',details:['资源额度与钱包检查在财务事务中再次核对；不足时不应在图上改标签假装扣费成功。','若业务已经完成，厂商消耗仍需纳入平台成本；客户结算失败不等于厂商成本为零。']});
edge(F,'quota-use','receipt','额度全覆盖','权益足够，钱包金额为0，仍记录服务用量账单。','balance_usage=0',{route:[[410,-38],[910,-38],[910,115]]});
edge(F,'quota-use','wallet-use','有缺口','缺少的次数按套餐单价从钱包结算。','balance_usage>0');
edge(F,'wallet-use','receipt','扣款通过','先赠金后现金，记录财务账单与交易。','钱包检查足够');
edge(F,'wallet-use','finance-shortage','钱包不足','财务事务再次核对余额，不足则写失败账单并返回402。','财务余额不足');
note(F,'finance-header','太忆云 · 资源额度与钱包',['入图或查询路径已确定待扣资源与单位数后，进入此结算子图：先额度，缺口再赠金、现金。','查询使用memory_search，入图使用memory_add；财务账单与usage统计分别记录，本轮没有执行真实扣款。'],0,-240,1340,180);
graph(F,'太忆云 · 资源额度与钱包','按上游确定的资源类型和单位数优先使用额度，缺口再用赠金和现金；余额不足写失败账单并返回402。','quota-use',[
  {id:'settle',title:'资源与钱包结算',question:'额度、赠金、现金怎样落账？',anchor:'quota-use',members:['wallet-use','receipt']},
  {id:'failure',parent:'settle',title:'不足分支',question:'钱包不足时如何记录？',anchor:'finance-shortage',members:[]}
]);
const candidate=await saveCandidate();
console.log(JSON.stringify({graphIds:candidate.graphIds,counts:candidate.counts}));
