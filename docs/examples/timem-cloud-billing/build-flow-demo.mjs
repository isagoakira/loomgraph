/** Review-only example builder. No network, no Canvas writes, no production billing changes. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const prefix = 'cloud-billing-20261006';
export const graphIds = { overview: 'timem-cloud-billing-flow', ingest: 'timem-cloud-billing-ingest', query: 'timem-cloud-billing-query', finance: 'timem-cloud-billing-finance', pricing: 'timem-cloud-billing-pricing', gates: 'timem-cloud-billing-gates' };
const docs = '/Users/Zhuanz1/Desktop/file/智悦/TiMEM/成本方案测算/图谱计价模型_2026-10-02/太忆云图谱计费推导.md';
const backend = '/Users/Zhuanz1/Desktop/file/智悦/TiMEM/timem-platform-backend';
const code = `${backend}/app/billing/graph_ingest_billing.py`;
const api = `${backend}/app/graph_management/api/graph_api.py`;
const report = '/Users/Zhuanz1/Downloads/平台图谱成本.md';
const thread = 'codex://threads/01a0fc1e-7da4-77a2-9374-7e5b5dadd070';
const colors = { code: '#426c64', proposal: '#aa743b', example: '#4f6795', risk: '#a85648' };
const html = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paragraphs = rows => rows.map(s => `<p>${html(s)}</p>`).join('');
const operations = [];
const nodes = new Map();
const graphDefs = [];
const entityById = new Map();
function node(g, id, title, summary, x, y, opts = {}) {
  const entityId = `${prefix}-${id}`;
  const repId = `${entityId}-rep`;
  const tier = opts.tier ?? 'code';
  const evidenceKind = tier === 'code' ? 'locally_verified' : tier === 'example' ? 'example' : 'hypothesis';
  const source = opts.source ?? (tier === 'code' ? api : docs);
  const entity = { id: entityId, kind: tier === 'code' ? '源码规则' : tier === 'example' ? '算术案例' : tier === 'risk' ? '待闭合条件' : '候选定价', title, description: summary, source,
    metadata: { semanticContent: { schemaVersion: 1, summary, sections: [{ id: `${id}-details`, title: opts.detailTitle ?? '口径与依据', html: paragraphs(opts.details ?? [tier === 'code' ? '本地源码已核验；生产环境开关、套餐及流水尚未读取。' : '此处是设计建议或情景测算，不代表已经上线。']) }], sources: [{label:source,kind:tier==='example'?'example':'source'}] },
      expression: {schemaVersion:1,takeaway:summary,keyPoints:opts.keyPoints??[],role:opts.role??'process',...(opts.input?{input:opts.input}:{}),...(opts.output?{output:opts.output}:{}),termIds:opts.terms??[],evidence:[{kind:evidenceKind,statement:tier==='code'?'已核对本地实现，不代表生产运行回执。':tier==='example'?'基于指定参数的算术案例。':'参考会话中的候选方案，尚未上线。',source}]},
      billingDemo: { version:'2026-10-06',tier,referenceThread:thread } } };
  if (!entityById.has(entityId)) { operations.push({type:'entity.put',entity}); entityById.set(entityId,entity); }
  const rep = {id:repId,entityId,graphId:g,x,y,width:opts.width??380,height:opts.height??230,pinned:false,style:{contentView:'card',strokeColor:colors[tier],backgroundColor:tier==='code'?'#f4f8f5':tier==='example'?'#f2f5fb':'#fff7ed',strokeWidth:1,roughness:0,notebook:{schemaVersion:1,role:'concept',branchId:'billing-flow',side:'right',order:nodes.size,notation:'process',bodyMode:'complete'}},...(opts.subgraphs?{subgraphIds:opts.subgraphs}:{})};
  operations.push({type:'representation.put',representation:rep});
  const value = {entityId,repId,g,ref:{type:'representation',id:repId}};nodes.set(`${g}:${id}`,value);return value;
}
function edge(g, from, to, label, explanation, condition = '', opts = {}) {
  const a=nodes.get(`${g}:${from}`),b=nodes.get(`${g}:${to}`);if(!a||!b)throw Error(`Missing endpoint ${from}/${to}`);
  const id=`${prefix}-${g}-${from}-${to}`;
  operations.push({type:'relation.put',relation:{id,kind:'sequence',from:a.entityId,to:b.entityId,label,
    metadata:{graphId:g,...(opts.route?{route:opts.route}:{}),presentation:{notation:opts.feedback?'feedback':'flow',fromRepresentationId:a.repId,toRepresentationId:b.repId},expression:{schemaVersion:1,explanation,transfers:opts.transfers??label,conditions:condition?[condition]:[],evidence:[{kind:opts.tier==='proposal'?'hypothesis':'analysis',statement:explanation,source:opts.source??(opts.tier==='proposal'?docs:entityById.get(a.entityId)?.source??api)}]}}}});
  return id;
}
function note(g,id,title,rows,x,y,width=1450,height=180) {
  const fid=`${prefix}-${id}`;
  operations.push({type:'free.put',freeElement:{id:fid,graphId:g,element:{id:fid,type:'rectangle',x,y,width,height,angle:0,strokeColor:'#d4d8d2',backgroundColor:'#fffdf8',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,roundness:null,boundElements:null,link:null,locked:false,version:1,versionNonce:1,seed:71006,isDeleted:false,updated:Date.now(),customData:{richTextBox:{schemaVersion:1,title,role:'text',html:paragraphs(rows),fontSize:20,fontFamily:'Avenir Next, PingFang SC, sans-serif',color:'#30463e',fill:'#fffdf8',border:'#d4d8d2'},agentCanvas:{freeElementId:fid,role:'free'}}}}});
}
const glossary=[
  {id:'cloud-money',term:'人民币分',definition:'太忆云钱包的金额口径；1元=100分。资源额度是服务权益，不等于本次新增现金收入。'},
  {id:'would-charge',term:'would_charge',definition:'记录按当前规则本应扣多少；模拟模式不扣用户额度或钱包。'},
  {id:'reference-cost',term:'参考成本 C',definition:'必要成功调用按指定成本报告计算的厂商费用；不是客户售价或完整平台成本。'},
  {id:'gamma',term:'成本放大 γ',definition:'平台真实厂商支出相对可归属成功逻辑工作的参考成本之比；1.5为压力假设，不是实测失败率。'},
  {id:'margin',term:'毛利率 g',definition:'1−完整直接交付成本/确认收入。100%加价率对应50%毛利，毛利不等于加价率。'},
  {id:'quota',term:'资源额度',definition:'套餐或资源包中可兑换的服务次数；额度不足的部分再按配置由钱包覆盖。'},
  {id:'idempotency',term:'幂等键',definition:'让同一逻辑任务的网络重放、轮询和重试共享身份，避免重复写入或扣款。'}
];
function graph(id,title,description,rootId,clusterDefs=[]) {
  const all=[...nodes.values()].filter(n=>n.g===id);
  const clusters=clusterDefs.map((c,i)=>({id:`${id}-${c.id}`,title:c.title,question:c.question,notation:'flow',parentId:c.parent?`${id}-${c.parent}`:null,order:i,anchor:nodes.get(`${id}:${c.anchor}`).ref,members:c.members.map(m=>nodes.get(`${id}:${m}`).ref),entry:[nodes.get(`${id}:${c.anchor}`).ref],exit:[nodes.get(`${id}:${c.members.at(-1)??c.anchor}`).ref],purpose:c.question}));
  const owner=Object.fromEntries(clusters.flatMap(c=>[c.anchor,...c.members].map(r=>[`${r.type}:${r.id}`,c.id])));
  const def={id,title,kind:'flow',description,metadata:{contentWorkspace:{schemaVersion:1,defaultView:'layout',order:all.map(n=>n.ref)},expression:{schemaVersion:1,scenario:'general',audience:'产品、工程和财务共同核对计费口径',objective:'以条件流程、局部子图和就地说明拆解现有规则与候选价格',thesis:description,glossary,routes:[{id:`${id}-route`,title:'按箭头阅读',steps:all.map(n=>n.ref)}]},organization:{schemaVersion:1,defaultIntent:'understand',clusters,links:[],layoutOwnerByRef:owner},billingDemo:{sourceThread:thread,sourceHead:'fb05edbeea8fdf6034adb8b8af1a6aad7b907d72',codeCheckedAt:'2026-10-06',productionVerified:false,notExecutionMonitor:true}}};
  graphDefs.push({type:'graph.put',graph:def});
}

// The graphs below deliberately use process-first placements, not a radial notebook layout.
const G=graphIds.overview;
node(G,'request','一次太忆云图谱请求','先辨认服务类型，再判断按什么资源计量。',0,390,{terms:['cloud-money'],details:['只解释太忆云 timem-platform-backend；不使用太忆空间24积分/元。','绿：本地源码；棕：候选方案；蓝：算术案例。整个示例没有发起真实扣费。']});
node(G,'route','判断：这次做什么？','入图、检索/问答、浏览/撤回走不同费用路径。',480,390,{role:'decision'});
node(G,'ingest-entry','A · 文档 / L3 / 表入图','先完成写入，再记录或结算当前规则的入图费用。',960,0,{source:`${backend}/app/graph_management/api/ingest_api.py`,subgraphs:[graphIds.ingest],details:['三个入口先返回202受理，再由后台处理文档块、L3段或表行。','任务完成状态、计费开关、任务去重和财务结算在下方子图分别展开。']});
node(G,'query-entry','B · 检索 / 问答','外部接口使用 memory.search；QA内部检索不另扣一次。',960,390,{subgraphs:[graphIds.query],terms:['quota']});
node(G,'browse','C · 浏览 / 邻域 / 撤回','不触发生成模型，不代表数据库托管和读写成本为零。',960,780);
node(G,'dry-result','默认入图：只记应扣','GRAPH_INGEST_BILLING_ENABLED 默认 false，不扣钱包。',1440,0,{source:code,terms:['would-charge'],subgraphs:[graphIds.ingest]});
node(G,'query-result','查询：先用额度，再用钱包','资源额度不足时，按配置转赠金与现金余额。',1440,390,{terms:['quota','cloud-money'],subgraphs:[graphIds.query]});
node(G,'capacity-result','托管成本仍要有人承担','主机、备份、数据库容量应单独标定与覆盖。',1440,780,{tier:'proposal',subgraphs:[graphIds.pricing]});
edge(G,'request','route','识别服务','同一次用户动作先按接口类型进入不同计费路径。');
edge(G,'route','ingest-entry','入图','文档、L3与表进入入图写入及计费协调器。','文档 / L3 / 表');
edge(G,'route','query-entry','查询','图谱search或qa进入现有memory.search计费路径。','search / qa');
edge(G,'route','browse','管理','浏览、邻域、来源撤回不按LLM Token触发模型费。','浏览 / 邻域 / 撤回');
edge(G,'ingest-entry','dry-result','开关默认关闭','默认只记录would_charge；启用后的扣款逻辑在子图中解释。');
edge(G,'query-entry','query-result','现有通道','按memory.search配置和可用权益扣减。');
edge(G,'browse','capacity-result','成本归属','无模型调用的数据库资源仍需容量价格覆盖。','候选容量方案',{tier:'proposal'});
note(G,'overview-header','太忆云 · 从请求到扣款',['当前实现与候选价格分开阅读。箭头是规则先后或条件，卡片不是正在运行的任务。','入口卡片的“＋”展开细则；子图入口展示局部流程。最后的候选模型入口：太忆云 · 从成本到报价。'],0,-260,1820,180);
graph(G,'太忆云 · 当前计费总流程','当前入图默认模拟，查询复用memory.search；独立图谱价格是候选方案，生产配置尚未核验。','request',[
  {id:'entry',title:'入口与分流',question:'这次请求属于哪一类？',anchor:'request',members:['route']},
  {id:'ingest',parent:'entry',title:'入图路径',question:'写入后是否真正扣费？',anchor:'ingest-entry',members:['dry-result']},
  {id:'query',parent:'entry',title:'查询路径',question:'查询从哪类权益扣除？',anchor:'query-entry',members:['query-result']},
  {id:'capacity',parent:'entry',title:'管理与托管',question:'无模型费还剩哪些成本？',anchor:'browse',members:['capacity-result']}
]);

// Candidate pricing: every price/guard is explicitly a proposal, not current production configuration.
const P=graphIds.pricing;
node(P,'reference','01 · 把模型用量换成参考成本 C','普通输入、缓存输入、输出、向量分别计量；缓存不能重复算。',0,0,{tier:'proposal',source:report,terms:['reference-cost'],details:['报告基价：非缓存输入0.20，缓存0.04，输出0.80，向量0.50元/百万Token。','同一输入中的缓存命中Token先扣出；仅按厂商usage确认命中。','价格以指定报告为基准，本轮没有联网核验最新厂商官价。']});
node(P,'pressure','02 · 加入不能转嫁的消耗 γ','失败、自动重试和预热进入平台成本；γ=1.5先作压力参数。',0,390,{tier:'proposal',terms:['gamma'],details:['γ不是HTTP失败率。按厂商所有收费与成功必要调用参考成本对账。','超时后厂商可能已经收费；失败调用费用不能在成本账本消失。']});
node(P,'target','03 · 定毛利目标 g=55%','守住50%底线；整个业务必须包含固定与变量交付成本。',0,780,{tier:'proposal',terms:['margin']});
node(P,'multiplier','推导：k ≥ γ / (1−g)','1.5 / 0.45 = 3.33，候选取4倍；模型部分毛利62.5%。',480,390,{tier:'example',terms:['gamma','margin'],details:['模型部分毛利=1−γ/k；1−1.5/4=62.5%。','固定主机、赠额、容量升配仍要加入全平台总成本，不能把62.5%当业务已实现毛利。','折扣δ后变成1−γ/(4δ)；γ=1.5时守55%要求δ≥0.8333。']});
node(P,'token-price','入图候选：成功实际Token×4','每百万Token：普通0.80 / 缓存0.16 / 输出3.20 / 向量2.00元。',960,0,{tier:'proposal',terms:['reference-cost'],details:['文档、L3与表的必要成功AI调用都进入同一公式。','40个典型块：成本0.0328元，候选价0.1312元（13.12分）。120块：0.3936元。','别名、融合、冲突产生的成功Token另加入。跳过项不收AI费，系统自动重试不重复向客户收费。']});
node(P,'qa-price','查询候选：检索 / QA各1分','QA包含内部检索；需要完整Token预算，平均成本不是硬上限。',960,390,{tier:'proposal',details:['建议QA输入≤8192、输出≤512、查询向量≤1024Token。这些输入/向量护栏尚未落实为完整当前能力。','最大模型成本0.00256元；乘γ=1.5后0.00384元，1分售价的模型毛利61.6%。','空图成功查询按已披露请求口径计费；非法输入、服务失败不收费是候选结算规则。']});
node(P,'base-price','容量候选：按 F/N 与权益反推','最低月费=(固定成本分摊＋赠额用满成本＋其他直接成本)/(1−g)。',960,780,{tier:'proposal',terms:['margin','quota'],details:['F是主机、已配置云盘、备份等完整固定交付成本；N是分摊容量池的付费账号数。','示例F=300元/月、N=25，无赠额，55%目标：最低26.67元。该金额不是现网报价。','29元含1000块/500QA/2000检索，在上述情景下仅52.4%毛利；4%额外收入损耗下贡献率48.4%。','因此早期29元保证达标的草案已被修正；资源包兑付是成本，不能当新增现金收入。']});
node(P,'candidate-bill','候选账单：容量＋计算＋查询','容量月费＋实际成功Token＋独立检索×1分＋QA×1分＋升配。',1440,390,{tier:'proposal',subgraphs:[graphIds.gates],details:['建议独立资源graph.ingest_compute、graph.search、graph.qa、graph.capacity，不挤占普通记忆次数。','高精度人民币累计、钱包按累计整分扣减，小于一分跨请求结转，不能每块向上取整。','生产上线前需通过路由、预算、账本与完整毛利四道核验。']});
edge(P,'pressure','multiplier','γ','成本放大参数进入最低倍数公式。','压力假设',{tier:'proposal'});
edge(P,'target','multiplier','目标55%','目标毛利决定公式分母1−g。','设计目标',{tier:'proposal'});
edge(P,'reference','token-price','成功必要Token','参考厂商费乘候选4倍得到对客入图价格。','非缓存 / 缓存 / 输出 / 向量',{tier:'proposal'});
edge(P,'multiplier','token-price','取4倍','可承受消耗倍数与目标毛利共同决定价格倍数。','非现价',{tier:'proposal'});
edge(P,'token-price','candidate-bill','计算费','必要成功调用的实际计算量计入账单。','成功提交部分',{tier:'proposal'});
edge(P,'qa-price','candidate-bill','请求费','外部search与qa分别计请求，qa内部search不叠加。','查询服务成功',{tier:'proposal'});
edge(P,'base-price','candidate-bill','容量费','固定成本、充分兑换权益及容量升配加入收入与成本。','容量档已标定',{tier:'proposal'});
note(P,'pricing-header','太忆云 · 从成本到候选报价',['棕色节点均为候选；蓝色节点是情景算式。4倍和1分来自参考会话最终推导，尚未上线。','报告均值、代码硬上限、规划频率和生产实测属于不同证据。固定月费保留公式，不伪造现网报价。'],0,-240,1820,170);
graph(P,'太忆云 · 从成本到报价','候选价格通过参考成本、消耗压力和55%目标逐步推导；固定月费与容量须另行标定。','reference',[
  {id:'cost',title:'成本与目标',question:'用哪些参数推导价格？',anchor:'reference',members:['pressure','target']},
  {id:'variable',parent:'cost',title:'变量费用',question:'4倍和1分是如何得来的？',anchor:'multiplier',members:['token-price','qa-price']},
  {id:'bill',parent:'cost',title:'完整账单',question:'固定成本和赠额由谁覆盖？',anchor:'base-price',members:['candidate-bill']}
]);

const V=graphIds.gates;
node(V,'shadow','① 先运行模拟账本','保留模型usage、厂商尝试、成功提交与would_charge，先不改生产收费。',0,0,{tier:'proposal',terms:['would-charge'],keyPoints:['厂商实际成本和客户应收分别留账。'],details:['来源会话的最终方案没有改生产计费配置。此图是上线决策流程，不是本轮已执行的流水。']});
node(V,'route-check','② 路由与成本报告一致？','文档/QA专用路由与L3默认GLM路径需要逐项核对。',480,0,{tier:'risk',role:'decision',keyPoints:['逐路径核对模型、价格版本和计量方式。'],details:['本地L3抽取、匹配和名字融合与报告描述不完全一致；部署实际模型未知。','先确认实际模型、价格档、Tokenizer与版本，再使用报告单价归属成本。']});
node(V,'budget-check','③ 成本与容量护栏可执行？','完整输入、统一重试、任务预算、容量边界都要有实际限制。',960,0,{tier:'risk',role:'decision',details:['文档120块不是总Token预算；并发默认4、上限8也不是总成本上限；400字符不是Token上限。','QA建议的8192输入/1024向量、统一一层重试与支出上限需实施验证。']});
node(V,'ledger-check','④ 客户与厂商账本对得上？','失败/部分成功/重放有明确规则，厂商费和客户费各自守恒。',960,390,{tier:'risk',role:'decision',terms:['idempotency'],details:['必要成功调用只结算一次；厂商失败收费仍计入平台成本。','同逻辑任务共享幂等键；部分成功只结算成功提交部分；小于一分结转。']});
node(V,'margin-check','⑤ 完整周期总毛利达标？','用真实频率、账单、折扣、权益兑付与容量升配重算目标。',480,390,{tier:'risk',role:'decision',terms:['gamma','margin'],details:['启动分布60%/25%/10%/5%只是轻用/常规/重用/批量四类规划权重。','按账号真实流水统计P50/P95/P99，不把独立参数的P95拼成账号P95。','两周可核对埋点，不能声称完整月分布；按1−总成本/总收入计算，不平均账号百分比。']});
node(V,'decision','通过才可进入正式收费评审','当前证据未闭合；缺哪项就回补哪项，不把候选方案当已发布价格。',0,390,{tier:'risk',details:['本轮只核对本地源码、历史推导与功能示例；没有读取生产账单或生产开关。','定价需要人类业务批准，本次没有对外发布、提交付款或变更收费。']});
edge(V,'shadow','route-check','形成回执','以影子计费记录核对模型路由。','模拟运行',{tier:'proposal'});
edge(V,'route-check','budget-check','路由吻合','已确认价格基准与实际调用一致，再验证完整预算。','通过',{tier:'proposal'});
edge(V,'budget-check','ledger-check','护栏可执行','总成本边界明确后对账。','通过',{tier:'proposal'});
edge(V,'ledger-check','margin-check','两本账闭合','客户确认收入与完整直接交付成本能准确归属。','通过',{tier:'proposal'});
edge(V,'margin-check','decision','满足目标与底线','用完整周期真实流水验证55%目标与50%底线。','通过',{tier:'proposal'});
edge(V,'route-check','shadow','路由不符','模型或价格基准不符时先修路由并重新模拟。','路由证据不足',{tier:'proposal',feedback:true,route:[[450,285],[410,285],[410,115]]});
edge(V,'budget-check','shadow','预算未落实','完整预算尚不可执行时回到模拟阶段补齐护栏。','预算证据不足',{tier:'proposal',feedback:true,route:[[900,-38],[410,-38],[410,115]]});
edge(V,'ledger-check','shadow','账本未闭合','双账本或幂等补偿未闭合时继续模拟与对账。','账本证据不足',{tier:'proposal',feedback:true,route:[[900,690],[410,690],[410,115]]});
edge(V,'margin-check','shadow','毛利不足：重算','完整周期毛利未达标时重新标定成本与候选价格。','毛利不足',{tier:'proposal',feedback:true});
note(V,'gates-header','太忆云 · 上线前的证据闭环',['这是一条决策流程，不是任务已完成的证明。棕红色节点表示待核验的真实条件。','硬上限限定最大消耗；统计分布预测常见账单。二者相互补充，不能把P95当硬上限。'],0,-240,1340,170);
graph(V,'太忆云 · 上线验证闭环','模型路由、完整预算、双账本和总毛利闭合后才评审上线。当前仅有本地实现与候选测算。','shadow',[
  {id:'prepare',title:'模拟与边界',question:'先确认实际调用和可执行的预算',anchor:'shadow',members:['route-check','budget-check']},
  {id:'prove',parent:'prepare',title:'对账与决策',question:'完整账本和毛利是否支持收费？',anchor:'ledger-check',members:['margin-check','decision']}
]);

// Ingest/query are added by a separate audited block below.
export { node, edge, note, graph, operations, graphDefs, nodes, entityById, here, prefix, code, api, backend, docs, report };

export async function saveCandidate(outName='flow-demo-operations.json') {
  const result={schemaVersion:1,sourceThread:thread,graphIds,operations:[...graphDefs,...operations],counts:{graphs:graphDefs.length,entities:entityById.size,representations:operations.filter(o=>o.type==='representation.put').length,relations:operations.filter(o=>o.type==='relation.put').length,freeElements:operations.filter(o=>o.type==='free.put').length},createdAt:new Date().toISOString()};
  await mkdir(here,{recursive:true});await writeFile(resolve(here,outName),JSON.stringify(result,null,2)+'\n');
  return result;
}
