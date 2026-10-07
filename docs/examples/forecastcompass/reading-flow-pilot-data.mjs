// Reading-flow validation sample. Source-reported facts and teaching examples remain distinct.
export const graphId = "forecastcompass-learning-pilot";
export const source = "ForecastCompass — 用户提供的 PDF";
export const concepts = [
  ["probability", "概率预测", "给多个候选结果分配信心，概率之和为 1。"],
  ["signal", "预测信号", "对判断未来结果有帮助的当前证据。"],
  ["calibration", "校准", "让一组预测的信心与实际正确频率相匹配。"],
  ["lesson", "可复用原则", "从旧记录提炼出新问题也能使用的检查与判断规则。"],
  ["subcategory", "预测子类别", "把同类预测场景组织在一起的记忆索引；形式符号 s 在研究展开中定义。"],
  ["factor", "因子记忆 F", "关于看哪些信号、检查什么证据和避免哪些误用的手册。"],
  ["reasoning", "推理记忆 R", "关于证据强弱、冲突和缺失应如何影响信心的手册。"],
  ["memory", "双记忆", "一个子类别对应的因子与推理两份手册；形式符号 M 在研究展开中定义。"],
  ["trajectory", "预测轨迹", "当时搜到了哪些证据，以及怎样据此形成概率；形式符号 z 在研究展开中定义。"],
  ["retrospective", "复盘轨迹", "揭晓后用结果后的证据形成的诊断材料，只用于未来记忆修订。"],
  ["brier", "Brier", "本文按所有候选结果计算平方误差之和；越低越好。"],
  ["ece", "ECE", "按信心分箱比较预测正确率与平均信心；越低越好。"],
  ["protocol", "实验协议", "固定模型、数据、时间窗口、指标及记忆更新方式，保证比较含义一致。"],
].map(([id,term,definition])=>({id,term,definition}));

// Table 1, columns are GPT/Prophet, GPT/FutureX, Gemini/Prophet, Gemini/FutureX.
export const methods = ["BASE (Retro)","BASE","Mem0","Reflexion","A-Mem","Graphiti","FoCo (Static)","FoCo"];
export const settings = [
  {id:"gpt-prophet",model:"GPT-5-mini",dataset:"Prophet Arena",focoRevisionEpochs:3},
  {id:"gpt-futurex",model:"GPT-5-mini",dataset:"FutureX",focoRevisionEpochs:2},
  {id:"gemini-prophet",model:"Gemini-2.5-Flash",dataset:"Prophet Arena",focoRevisionEpochs:3},
  {id:"gemini-futurex",model:"Gemini-2.5-Flash",dataset:"FutureX",focoRevisionEpochs:2},
];
const mainRows = [
  [.109,.079,.197,.209,.187,.098,.241,.279],
  [.150,.114,.241,.263,.202,.106,.266,.299],
  [.149,.101,.197,.217,.208,.125,.272,.296],
  [.150,.086,.203,.222,.196,.114,.252,.266],
  [.109,.092,.194,.208,.204,.115,.269,.287],
  [.134,.097,.218,.244,.215,.140,.275,.301],
  [.083,.089,.203,.219,.134,.112,.243,.237],
  [.075,.077,.187,.195,.118,.090,.216,.198],
];
export const results = mainRows.flatMap((row,i)=>settings.map((setting,j)=>({
  id:`table1:${setting.id}:${i}`,configId:setting.id,method:methods[i],brier:row[j*2],ece:row[j*2+1],
  source:"Table 1",sourceSection:"§4.2 / Table 1",aggregation:"原表跨评估周的平均值",kind:"source_reported",
  deployable:i!==0,
})));
export const ablation = [
  {id:"base",method:"BASE",removed:"全部外部记忆",brier:[.310,.232,.211,.210,.241],ece:[.396,.193,.242,.220,.263]},
  {id:"no-factor",method:"FoCo w/o factor",removed:"因子记忆 F",brier:[.233,.217,.200,.178,.207],ece:[.325,.196,.230,.083,.209]},
  {id:"no-reasoning",method:"FoCo w/o reasoning",removed:"推理/校准记忆 R",brier:[.246,.208,.214,.150,.205],ece:[.331,.179,.238,.133,.220]},
  {id:"full",method:"FoCo",removed:"无",brier:[.221,.202,.180,.144,.187],ece:[.292,.177,.219,.091,.195]},
].map(row=>({...row,configId:"gpt-futurex",source:"Table 3",sourceSection:"§4.4 / Table 3",kind:"source_reported"}));
export const config = [
  {id:"runtime",key:"调用环境",value:"OpenAI SDK",scope:"全部实验，原文表述",source:"附录 B.1",state:"原文报告"},
  {id:"model",key:"预测骨干",value:"GPT-5-mini / Gemini-2.5-Flash",scope:"按设置选择；通常构建/修订使用同一骨干",source:"§4.1",state:"原文报告"},
  {id:"effort",key:"推理设置",value:"medium reasoning effort",scope:"GPT-5-mini，除另有说明",source:"附录 B.1",state:"原文报告"},
  {id:"sampling",key:"采样设置",value:"top_p = 0.7",scope:"附录 B.1 的默认设置",note:"执行时还需核实 API 是否实际采用",source:"附录 B.1",state:"原文报告"},
  {id:"cutoff",key:"搜索信息截止",value:"不晚于事件揭晓前一周",scope:"搜索证据的时间窗口",note:"按 §2、§3.3 与附录 C，结果后材料不回填为原预测输入",source:"附录 B.1",state:"原文报告"},
  {id:"epochs",key:"FoCo 记忆修订 epochs",value:"Prophet Arena 3；FutureX 2",scope:"FoCo 按数据集选择的修订设置",note:"各基线的记忆适配另见附录 A.3，不能把此值视为每个基线的共同执行步骤",source:"附录 B.1 / B.8",state:"原文报告"},
  {id:"selection",key:"epochs 选择",value:"Week 0 开发，Week 1 held-out 比较",scope:"修订轮数的选参过程",note:"选参结果与主评估的角色需区分",source:"附录 B.8 / Table 9",state:"原文报告"},
  {id:"data",key:"数据周次",value:"Week 0–4；640 / 242 个问题",scope:"Prophet Arena / FutureX 的数据构成",note:"具体存档与日期需再核实",source:"附录 A.1 / Table 4",state:"原文报告"},
  {id:"metrics",key:"指标口径",value:"多类 Brier 的平方误差求和；ECE 以最大预测概率为信心后分箱",scope:"概率准确性与校准指标",note:"不能直接混用二元单项 Brier 的缩放口径",source:"附录 A.2",state:"原文报告"},
  {id:"prompts",key:"算法与提示",value:"附录 C 算法；附录 E / Table 13–18 提示模板",scope:"Agent 和记忆修订的算法与提示",note:"模板预算、检索上限与实际参数仍需逐项核实",source:"附录 C / E",state:"原文报告"},
  {id:"unverified",key:"复现待核实项",value:"SDK 版本、模型快照、代码版本、数据存档、ECE 分箱数、工具预算",scope:"本样例不补写默认值",source:"尚待原文/代码与运行核对",state:"未核实"},
].map(row=>({...row,noteKind:row.note?"analysis":undefined}));

const section=(id,title,html)=>({id,title,html});
export const steps = [
  {
    id:"probability",role:"background",question:"预测未来，究竟在预测什么？",label:"必要背景",
    requires:[],introduces:["probability"],uses:["probability"],next:"给出了概率，还需要知道它为什么可信。",
    takeaway:"预测给每个可能结果分配概率，让不确定性也成为答案的一部分。",
    body:["先想一个尚未揭晓的选举：X 会赢，还是会输？说“X 有 70% 的胜率”，就是给赢分配 0.70，给输分配 0.30。", "一次输了不直接证明 70% 的判断无效。我们还需要考察许多预测的表现，以及预测时能得到什么证据。接下来的案例只是讲解，不是本机预测结果。"],
    visual:"probability",source:"§2；选举与 70% 为讲解案例",sourceKind:"example",
    sections:[section("formal","概率与时间的约定","<p>把问题记为 q，候选结果的概率记为 p。每个分量非负，所有候选结果概率之和为 1。预测时刻之后才出现的信息，不能回填为当时可用证据。</p><p>§2 描述真实预测与结果后复盘的不同信息条件。本样例的 70% 用来解释概率，不是作者评测值。</p>")],
  },
  {
    id:"signal-confidence",role:"contrast",question:"查到了新闻，为什么还是会判断差？",label:"建立区分",
    requires:["probability"],introduces:["signal","calibration"],uses:["probability","signal","calibration"],next:"既然有两种错误，过去的经验应该分别教会我们什么？",
    takeaway:"预测既需要找到有用的信号，也需要把证据转成适当的信心。",
    body:["第一种错误是看错或漏看证据，例如只追逐显眼新闻，却忽略民调覆盖不足。第二种错误是看到了局限，仍把概率推得太极端。", "让大量相似信心的预测，与实际正确频率相匹配，叫作校准。例如一批约 70% 信心的判断，长期正确频率也应接近 70%。这要用一组预测评价。"],
    visual:"contrast",source:"§2–3；民调说明为讲解案例",sourceKind:"example",
    sections:[section("metrics","研究展开：两个评价指标","<p><b>Brier</b>衡量预测概率与实际结果的距离，本文将所有候选结果的平方误差求和。二元例子 p=(.70,.30)，若 X 赢，真实结果 y=(1,0)，Brier=(.70−1)²+(.30−0)²=.18。</p><p><b>ECE</b>先取最大预测概率作为信心，再按信心分箱；每箱比较预测正确率与平均信心，并按样本数加权。两者都越低越好，但回答的问题不同。</p><p>精确定义见附录 A.2。这里的 .18 是讲解计算，不是论文实验值。ECE 的具体分箱数量仍需核实。</p>")],
  },
  {
    id:"memory-problem",role:"problem",question:"把旧预测存下来，还缺什么？",label:"本文的问题",
    requires:["signal","calibration"],introduces:["lesson"],uses:["signal","calibration","lesson"],next:"FoCo 因此把经验拆成两类可修订的手册。",
    takeaway:"下一次需要的是可复用的检查原则，而不只是上一次的事件答案。",
    body:["旧记录可能写着“X 最后输了”，却没有说明下次该查哪些信号，或遇到冲突证据时该怎样控制信心。本文将已揭晓记录归纳成未来能用的经验，这套方法叫 ForecastCompass，简称 FoCo。", "有用的原则例如“检查民调样本与未决定选民”，或“覆盖不足时避免极端信心”。这些原则可以指导新问题；新的证据仍然要重新搜索。"],
    visual:"lesson",source:"§1、§3.1；原则措辞为讲解展开",sourceKind:"analysis",
    sections:[section("baselines","研究展开：比较对象的含义","<p>论文比较无外部记忆的 BASE，保留初始双记忆但不做周更新的 FoCo (Static)，以及 Mem0、Reflexion、A-Mem、Graphiti。它们的适配信息与周更新方式见附录 A.3。</p><p>BASE (Retro) 使用结果后的信息，是不可部署的诊断参考。完整 FoCo 与这些方法的比较需要保留各自的信息条件。</p>")],
  },
  {
    id:"two-memories",role:"structure",question:"两份手册分别存什么？",label:"核心概念",
    requires:["lesson","signal","calibration"],introduces:["subcategory","factor","reasoning","memory"],uses:["subcategory","factor","reasoning","memory"],next:"分清手册内容后，就能跟着一个新问题看它怎样被使用。",
    takeaway:"同类问题共享两份手册：因子记忆 F 指导看什么，推理记忆 R 指导信多少。",
    body:["例如“美国总统选举”是一类可以反复复用经验的问题。新问题会被归到这样的子类别，再找到对应两份手册。手册保存的是过去已揭晓记录中归纳出的经验。", "F 的因子条目说明信号名称、证据检查、常见误用和典型概率影响。R 的推理条目说明强弱、冲突和缺失证据应该怎样改变信心。"],
    visual:"memory",source:"§3.1，式 (2)–(3)",sourceKind:"source_reported",
    sections:[section("symbols","研究展开：符号与结构","<p>分类法 T 将问题分入类别 c 和子类别 s。更新轮次记为 w，该轮子类别的记忆是 M₍w,s₎=(F₍w,s₎,R₍w,s₎)。F 是多个因子条目的集合；R 是校准与推理原则。</p><p>概念前置是阅读安排；这里的分类结构也不是执行依赖。每个因子的典型概率影响是语言指导，不是固定数值权重。</p>")],
  },
  {
    id:"inference",role:"flow",question:"新问题来了，手册怎样进入预测？",label:"预测机制",
    requires:["memory","subcategory","factor","reasoning","probability"],introduces:["trajectory"],uses:["memory","subcategory","factor","reasoning","probability","trajectory"],next:"当真实结果揭晓，我们才能知道哪些检查和判断需要改进。",
    takeaway:"先定位同类经验，再结合当前证据输出概率，并保留当时的预测轨迹。",
    body:["新选举问题先被归入对应子类别，取出 F、R。Agent 在这里指会使用搜索工具的语言模型：它依据 F 检查当前信号，用 R 处理证据强弱与冲突，最后给出概率。", "它同时保留查证与判断的过程，称为预测轨迹：搜到了什么、怎样解释证据、为什么给这个概率。未来复盘要与这份当时记录对照。"],
    visual:"forecast",source:"§3.2，式 (4)",sourceKind:"source_reported",
    sections:[section("formal","研究展开：预测输入输出","<p>q 表示未揭晓问题，E 表示预测时可访问证据，M₍w,s₎ 表示检索到的两类记忆。Agent Aθ 输出预测轨迹 z 和概率 p：(z,p)=Aθ(q,E,M₍w,s₎)。</p><p>机制解读：论文描述的是外部语言记忆修订，未报告该流程中的模型参数训练。这里是一份方法解释，没有产生真实模型运行。工具搜索必须满足预测时的信息边界。</p>")],
  },
  {
    id:"update",role:"timeline",question:"结果揭晓后，怎样把错误变成新经验？",label:"学习机制",
    requires:["trajectory","memory","factor","reasoning"],introduces:["retrospective"],uses:["trajectory","memory","factor","reasoning","retrospective"],next:"有了完整闭环，还需要实验判断它是否改善预测。",
    takeaway:"对照当时预测与结果后复盘，归纳可复用的错误模式，局部修订给未来使用。",
    body:["揭晓之后才生成复盘轨迹，解释哪些证据和推理能支持已发生的结果。它和原预测的差异分成因子问题与推理问题。", "先诊断哪里出了问题，再汇总多条复盘中的重复模式（聚合），最后改写手册（修订）。这样筛掉只对一次事件成立的事后解释。", "只更新这批记录用到的子类别：F 局部修订受影响因子，R 修订相应推理原则。更新后的手册只供未来使用，当时的预测与预测轨迹保留原样。"],
    visual:"update",source:"§3.3，式 (5)–(10)；附录 C",sourceKind:"source_reported",
    sections:[section("algorithm","研究展开：内部更新与原图","<p>分类法先处理可归类与未匹配的问题，对可复用的新模式扩展类别/子类别。对已揭晓记录生成复盘后，比较原预测与复盘，产生因子差异 ΔF 和推理差异 ΔR。</p><p>经诊断、聚合、修订，选中受影响的因子进行局部修改，重复 N 轮。分类法、逐条诊断和聚合步骤没有全部被 Table 3 单独消融；须区分流程描述和实验归因。</p><p>下面的原始 Figure 2 来自同一份论文，用来核对 A 记忆、B 预测、C 更新。原图中的具体例子不是本机实验。</p>")],
  },
  {
    id:"evidence",role:"comparison",question:"实验分别支持哪些结论？",label:"定量证据",
    requires:["probability","calibration","factor","reasoning","retrospective"],introduces:["brier","ece","protocol"],uses:["brier","ece","protocol","factor","reasoning"],next:"要复现这些比较，最后把条件固定到一份可核查的配置里。",
    takeaway:"主结果看整体效果，静态对照看持续修订，去 F/R 对照看同条件性能差异。",
    body:["Brier 衡量概率与结果的距离：很确信却猜错会受到更大惩罚。ECE 检查一组预测的信心与实际正确率是否一致。两者越低越好。", "BASE 不使用外部记忆；静态 FoCo 保留初始手册但不随每周结果更新；完整 FoCo 持续修订。组件消融则在同样条件下去掉 F 或 R，观察性能变化。", "下表固定预测模型为 GPT-5-mini、题集为 FutureX。平均结果支持完整方法优于 BASE 与静态记忆；逐周结果用于检查整体优势背后的差异。"],
    visual:"results",source:"Table 1、Table 3；附录 A.2",sourceKind:"source_reported",
    sections:[section("main-results","研究展开：主结果的四种设置","<p>Table 1 包含两个模型 × 两个数据集。下方选择设置后，完整列出该条件的结果，BASE (Retro) 标为结果后诊断参考。</p>"),section("ablation","研究展开：完整消融与局部差异","<p>Table 3 只在 FutureX / GPT-5-mini 上比较 F/R 移除。第四周去掉 F 的 ECE 为 .083，完整方法为 .091；平均 ECE 则为 .209 与 .195。总体优势与局部差异同时保留。</p><p>移除 F 后平均 Brier 比完整方法高 .020；移除 R 后高 .018。这些是原表平均值的差值，不是各模块可相加的独立因果收益。</p>"),section("statistics","研究展开：统计与覆盖边界","<p>附录 B.5 / Table 6 报告 Brier 的 10,000 次 bootstrap、95% 区间和与 BASE 的配对比较。其聚合口径应另行核对，不能直接与主表均值合并。本样例没有将该分析扩写成 F/R 消融差值的显著性证明。</p><p>跨时间/模型迁移、记忆质量与长度分析还有独立证据。此样例完成主结果、组件消融和复现配置的展开；尚未覆盖全文全部实验。</p>")],
  },
  {
    id:"reproduction",role:"synthesis",question:"研究者现在能据此复现什么？",label:"归纳与行动",
    requires:["protocol","brier","ece","memory"],introduces:[],uses:["protocol","brier","ece","memory"],next:"用同样的模型、工具与时间协议，检验迁移到新项目后的收益。",
    takeaway:"先统一配置与评价口径，再复现双记忆及更新；缺项保留为待核实。",
    body:["原文报告模型、搜索时间窗口与修订轮数。软件版本、数据存档和搜索调用预算等还需核实；具体参数与缺项放在下面的统一配置里。", "若把这套机制迁移到另一个项目，应固定模型、搜索工具、可用证据的截止时间和调用预算，再比较无记忆、静态双记忆、动态双记忆与去 F/R 的结果。这是需要重新检验的研究假设。"],
    visual:"synthesis",source:"§4.1；附录 A、B.1、B.8、C、E；迁移方案为分析",sourceKind:"analysis",
    sections:[section("configuration","研究展开：统一配置与待核实项","<p>主结果共享同一实验协议，模型、数据集与 FoCo 修订轮数按设置变化。基线的记忆适配方式各有不同，不能视为同一执行步骤。</p><p>原文报告值、实际运行采用值和方案建议应分别记录。本样例只核实原文报告，未复现实验。</p>"),section("next-experiment","研究展开：受控迁移实验","<p>冻结数据和时间划分，固定模型、工具与调用预算，依次比较 BASE、静态 F/R、动态 F/R，再比较去 F 与去 R。记录逐任务概率、真实结果、搜索来源与记忆版本，同时检查准确性与校准。</p><p>跨模型记忆转移要额外记录构建模型与预测模型，不能与同骨干结果合并。运行前还需要补齐本配置表的待核实项。</p>")],
  },
];
export const quiz = [
  {id:"division",question:"查到了信号，但把弱证据当成强证据，优先对应哪份手册？",options:["推理记忆 R：校准证据到信心的转换","因子记忆 F：只决定结果答案","直接训练模型权重"],answer:0,reason:"R 处理证据强弱、冲突和缺失如何影响概率。"},
  {id:"time",question:"结果后的复盘可以影响什么？",options:["后续问题使用的记忆","补写同一问题当时的预测","让 BASE (Retro) 成为可部署预测"],answer:0,reason:"原预测保留原样，结果后的经验只能服务后续预测。"},
  {id:"ablation",question:"平均值支持完整方法更好，第四周去掉 F 的 ECE 更低，该怎么解释？",options:["同时保留平均优势与局部差异，继续检查稳定性","完整方法每周每个指标都最好","F 和 R 的收益可以直接相加"],answer:0,reason:"同条件的整体趋势和逐周差异回答不同问题。消融差值不是可相加的独立因果贡献。"},
];

export const bundle = {schemaVersion:1,graphId,title:"ForecastCompass · 连续讲解验证",concepts,steps,settings,results,ablation,config,quiz};
