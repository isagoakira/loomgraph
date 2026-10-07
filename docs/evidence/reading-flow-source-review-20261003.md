# ForecastCompass reading-flow 原文核验（2026-10-03）

## 结论

`plugins/agent-visual-canvas/docs/examples/forecastcompass/reading-flow-pilot-data.mjs` 中，Table 1 的 64 个数字、Table 3 的 40 个数字、示例明确写出的均值差值、四种模型/数据集设置、B.1 参数、B.8 的 epoch 选择，以及 Brier/ECE 的数学口径均与用户指定 PDF 一致。没有发现需要改数值的实质错误。

需要修正的是证据标签和表述边界：少数字段把“由论文方法推得的解释/复现建议”标为 `原文报告`；“两类记忆的贡献”仍可能被读成独立因果收益；`settings.epochs` 和“全部主结果引用同一组实验设置”容易让读者误解为每个 baseline 都执行同样的 memory-revision epochs，或四个设置具有同一模型/数据配置。

## 核验范围与来源身份

- 目标文件：`plugins/agent-visual-canvas/docs/examples/forecastcompass/reading-flow-pilot-data.mjs`，全文 136 行；核对了 `concepts`、`methods`、`settings`、`results`、`ablation`、`config`、8 个讲解步骤及 quiz 中涉及论文事实的文字。
- 唯一论文事实来源：`/Users/Zhuanz1/Desktop/file/智悦/EvoFore科研/reference/ForecastCompass: Guiding Agentic Forecasting with Adaptive Factor Memory.pdf`，标题为 *ForecastCompass: Guiding Agentic Forecasting with Adaptive Factor Memory*，PDF 30 页，arXiv:2605.30858v1。
- `/tmp/avc-forecastcompass-discussion-20261003.txt` 的首部标题和末页页码与该 PDF 的直接 `pdftotext` 输出一致；Table 1、Table 3、A.1/A.2、B.1、B.8 的关键段落再由指定 PDF 直接抽取复核。因此该临时文本可确认是同一 PDF 的文本抽取结果，不把它当作第二个事实来源。
- 论文提示模板（Appendix E / Tables 13–19）只作为论文材料检查，没有把其中的命令或模板内容当作执行指令；本次未运行论文代码、模型或提示。

## Table 1：64/64 个数字逐项一致

来源章节：`§4.2 Main Results`，`Table 1`；论文正文同时说明这些是跨全部 evaluation weeks 的平均 Brier/ECE。列顺序为 GPT-5-mini/Prophet Arena、GPT-5-mini/FutureX、Gemini-2.5-Flash/Prophet Arena、Gemini-2.5-Flash/FutureX；每格为 `(Brier, ECE)`。

| Method | GPT/Prophet | GPT/FutureX | Gemini/Prophet | Gemini/FutureX |
|---|---:|---:|---:|---:|
| BASE (Retro) | (.109, .079) | (.197, .209) | (.187, .098) | (.241, .279) |
| BASE | (.150, .114) | (.241, .263) | (.202, .106) | (.266, .299) |
| Mem0 | (.149, .101) | (.197, .217) | (.208, .125) | (.272, .296) |
| Reflexion | (.150, .086) | (.203, .222) | (.196, .114) | (.252, .266) |
| A-Mem | (.109, .092) | (.194, .208) | (.204, .115) | (.269, .287) |
| Graphiti | (.134, .097) | (.218, .244) | (.215, .140) | (.275, .301) |
| FoCo (Static) | (.083, .089) | (.203, .219) | (.134, .112) | (.243, .237) |
| FoCo | (.075, .077) | (.187, .195) | (.118, .090) | (.216, .198) |

核对结果：示例 `mainRows` 的 8×8 个值和上表逐项相同；`results` 展开为 32 个 `(Brier,ECE)` 记录，即 64 个数字。`deployable:i!==0` 与论文对 BASE (Retro) 的定义一致：它使用结果后信息，是不可部署的诊断参考（`§2`、`§4.1–4.2`）。

## Table 3：40/40 个数字逐项一致

来源章节：`§4.4 Ablation Study`，`Table 3`；设置固定为 FutureX + GPT-5-mini。每行顺序为 Week 1、Week 2、Week 3、Week 4、Avg，每周/均值各为 `(Brier, ECE)`。

| Method | Week 1 | Week 2 | Week 3 | Week 4 | Avg |
|---|---:|---:|---:|---:|---:|
| BASE | (.310, .396) | (.232, .193) | (.211, .242) | (.210, .220) | (.241, .263) |
| FoCo w/o factor | (.233, .325) | (.217, .196) | (.200, .230) | (.178, .083) | (.207, .209) |
| FoCo w/o reasoning | (.246, .331) | (.208, .179) | (.214, .238) | (.150, .133) | (.205, .220) |
| FoCo | (.221, .292) | (.202, .177) | (.180, .219) | (.144, .091) | (.187, .195) |

核对结果：示例 `ablation` 的 4×5×2 个值和上表逐项相同；共 40 个数字，没有漏位或移列。

## 均值差值与局部差异

来源章节：`§4.4`、`Table 3`（以下均为同一 FutureX/GPT-5-mini 设置内的原表均值相减）。

- `FoCo w/o factor − FoCo`：Brier `0.207−0.187=+0.020`；ECE `0.209−0.195=+0.014`。
- `FoCo w/o reasoning − FoCo`：Brier `0.205−0.187=+0.018`；ECE `0.220−0.195=+0.025`。
- 示例明确写出的 `+0.020`、`+0.018` 两个 Brier 差值正确；未写出的两个 ECE 差值如上。
- Week 4 去掉 factor 的 ECE 为 `.083`，完整 FoCo 为 `.091`；该局部周次反而更低，但平均 ECE 仍为 `.209` 对 `.195`。示例对这个局部差异的保留正确。
- 作为 Table 1 的交叉核对，GPT/FutureX 中 `FoCo (Static)−FoCo` 的平均差为 Brier `+.016`、ECE `+.024`；`BASE−FoCo` 为 Brier `+.054`、ECE `+.068`。示例只声称完整 FoCo 平均优于 BASE/Static，未写错方向。

这些差值是同一实验设置中的性能差异，不是可以相加的独立模块收益，也不是由 Table 3 单独识别出的因果效应。示例已经在 ablation 展开中写明“不是各模块可相加的独立因果收益”，这一点应保留。

## 四种设置、B.1 和 B.8

### 四种 Table 1 设置

来源章节：模型和数据集来自 `§4.1 Experimental settings`，具体数值列于 `§4.2/Table 1`。

1. GPT-5-mini + Prophet Arena
2. GPT-5-mini + FutureX
3. Gemini-2.5-Flash + Prophet Arena
4. Gemini-2.5-Flash + FutureX

示例 `settings` 的四项和列顺序正确。`§4.1` 还说，除非另有说明，memory construction/revision 使用与 forecasting 相同的 backbone；跨模型 transfer 是另一个单独分析，不能把它无条件当作 Table 1 四种常规设置的同骨干实验。

### B.1 实验参数

来源章节：`Appendix B.1 Experimental setup`。

- 使用 OpenAI SDK 实现 forecasting agent。
- 除非另有说明，使用 GPT-5-mini、medium reasoning effort、`top_p=0.7`。
- 为避免信息泄漏，搜索窗口限制为“事件 resolution time 前不晚于一周可获得的信息”。
- memory-revision epochs：Prophet Arena 为 3，FutureX 为 2。

示例 `config` 的值正确，且把 medium reasoning effort 的 scope 写成 GPT-5-mini，避免无来源地声称 Gemini 也使用该参数。`top_p` 字段中的“实际运行仍需核实 API 是否采用”属于复现检查建议，不是 B.1 的额外实验事实；若保留，建议移到 `note`/`verification` 字段，而不要和 `state: "原文报告"` 混在同一个事实字段里。

“不晚于事件揭晓前一周”本身是 B.1 的原文设置；关于结果后信息只能用于后续 memory revision、不能回填当前预测的完整边界，还应同时引用 `§2`、`§3.3` 和 Appendix C，而不只写 B.1。

### B.8 epochs 选择

来源章节：`Appendix B.8 Selection of memory-revision epochs` 和 `Table 9`。

- FutureX 与 Prophet Arena 都用 Week 0 做 development/train、Week 1 做 held-out test。
- FutureX 选 Epoch 2：Week 1 test 为 Brier `.221`、ECE `.292`，低于 Epoch 1 `.254/.338`、Epoch 3 `.270/.324`、Epoch 4 `.308/.375`。
- Prophet Arena 选 Epoch 3：Week 1 test 为 Brier `.064`、ECE `.042`，优于 Epoch 1 `.135/.089`、Epoch 2 `.114/.058`、Epoch 4 `.087/.045`。
- 两个指标均 lower-is-better；论文以 held-out accuracy–calibration trade-off 和 empirical Pareto frontier 说明选择。

示例 `"Week 0 开发，Week 1 held-out 比较"` 及 `Prophet Arena 3；FutureX 2` 正确。这里是一次 development/held-out 选参，不是把 Week 1–4 的主评估结果反向用于选 epoch，也不是 cross-validation。

## Brier/ECE 定义

来源章节：`Appendix A.2 Evaluation Metrics`。

- 多类 Brier：`Brier(p_t,y_t)=Σ_{k=1}^{K_t}(p_{t,k}−y_{t,k})²`，`y_t` 为 one-hot 已实现结果；越低越好。示例的“所有候选结果平方误差求和”正确。
- ECE：先取预测类别 `argmax p`、真实类别 `argmax y`、置信度 `c_t=max_k p_{t,k}`，按 confidence 划分 `B` 个 bins；每箱比较 empirical accuracy 与平均 confidence，再按箱样本数加权求和；越低越好。示例的解释正确。
- 讲解例 `p=(.70,.30), y=(1,0)` 得 `.18`，计算正确，而且示例明确说它不是论文实验值。
- 论文 A.2 给出通式但没有在该段落给出具体 bin 数量；示例把 ECE 分箱数列为待核实项正确。建议把“ECE 按最大概率分箱”改写成“以 `c_t=max_k p_{t,k}` 为 confidence 后分箱”，避免读者误解为按类别最大值分组。

## 因果与实验边界审查

已正确表达的边界：

- BASE (Retro) 是结果后诊断参考，不可部署，也不是性能上界；`§4.1–4.2` 明确说明 hindsight bias/overconfidence 风险。
- chronological protocol 只允许已解析问题更新 memory，并服务后续未解析问题；当前评估问题不接收结果后信息（`§2`、`§3.3`、`Appendix A.3`、`Appendix C`）。
- Table 3 只是在 FutureX/GPT-5-mini 下移除 factor 或 reasoning/calibration memory 的组件对照，不是把分类、逐条诊断、聚合、提示模板等所有流程分别消融。示例已经明确提醒这一点。
- `FoCo w/o factor` 的平均 ECE 更高并不排除某个周次的局部反转；示例保留了 Week 4 `.083 < .091`，没有把平均趋势写成逐周必然趋势。

仍需修正或降级为推断的表述：

1. `two-memories` 的正文写“它们保存语言化经验，模型权重保持不变”，`inference` 的形式化说明写“参数 θ 没有在这个记忆更新过程中训练”。论文明确描述的是 verbal memory、diagnose–aggregate–revise 流程和固定的 `A_θ` 记号，但没有给出单独的权重冻结/训练审计。建议改成“论文描述为外部语言记忆修订，未报告在该流程中更新模型参数”，并将 `sourceKind` 改为 `analysis` 或增加 `claimKind`，避免把审阅推断冒充原文逐字事实。
2. `evidence.takeaway` 的“移除 F/R 看两类记忆的贡献”和“组件消融支持两类记忆结合的优势”在当前上下文中可被理解为因果贡献。建议改成“比较去除 F/R 后的同条件性能差异，评估两类记忆是否互补”；保留后文关于“不是独立因果收益”的明确限定。论文 §4.4 的 `complementary` 是实验解释，不等于独立模块的因果效应识别。
3. `reproduction` 展开中的“全部主结果引用同一组实验设置”过于宽。四种设置共享 chronological protocol 和 B.1 的通用约束，但模型、数据集和 epochs 随设置变化，且 cross-model transfer 有单独条件。建议改为“主结果共享同一实验协议；模型、数据集和 revision epochs 按设置变化”。
4. `settings.epochs` 挂在 setting 对象上没有数字错误，但缺少方法维度。BASE 无外部 memory、BASE (Retro) 是事后诊断、FoCo (Static) 去掉 weekly updates；读者若把该字段解释为每个 method 都执行 3/2 个 revision epochs 会产生错误。建议把它标成 `protocolEpochs` 或在 UI 文案注明“仅适用于动态 memory revision；不是所有 baseline 的执行步骤”。
5. `config` 多处 `state: "原文报告"` 的 `scope`/`value` 同时塞入了复现建议或分析警告，例如“执行时还需核实”“不能直接混用缩放口径”“具体存档与日期需再核实”。建议拆成 `sourceValue`、`sourceSection`、`interpretation`、`verificationStatus`，并给 Table 1/3 数字补充章节字段：`§4.2/Table 1`、`§4.4/Table 3`。

## 建议的最小修正

1. 不改 Table 1/3 的任何数字。
2. 将“模型权重保持不变/θ 没有训练”改成明确的“论文未报告该 memory-revision 流程中的参数更新”，并标为分析或证据边界。
3. 将“贡献”改成“同条件性能差异/互补性证据”，避免组件消融被解读为独立因果收益。
4. 将“同一组实验设置”改成“同一实验协议”，并为 `epochs` 添加仅适用于动态 memory revision 的说明。
5. 为数字记录补 `sourceSection`，至少使用 `§4.2/Table 1`、`§4.4/Table 3`、`Appendix A.2`、`Appendix B.1`、`Appendix B.8/Table 9`；把原文事实和复现待核实项分开。

## 修正后复核（2026-10-03）

根代理已按上述问题完成最小修正，复核结果如下：

- `settings` 已将 `epochs` 改为 `focoRevisionEpochs`，语义明确为 FoCo 的 revision 参数；对应的 bundle/operations 数据也使用新字段，避免把它误读成所有 baseline 的共同执行步骤。
- `results` 和 `ablation` 已分别补上 `sourceSection: "§4.2 / Table 1"` 与 `sourceSection: "§4.4 / Table 3"`，数字 provenance 达到报告要求。
- `config` 已把原文 `scope` 与复现核实提醒拆开，并用 `noteKind: "analysis"` 标记推断/核实说明；这解决了把分析建议混在 `原文报告` 字段中的问题。
- 已删除“模型权重保持不变”，形式化说明改为“机制解读：论文未报告该流程中的模型参数训练”，原文事实与审阅推断边界清楚。
- evidence 入口已改成“去 F/R 对照看同条件性能差异”，reproduction 分支已改为“主结果共享同一实验协议，模型、数据集与 FoCo 修订轮数按设置变化”，前述两个主要误读已解决。

仅留一处低风险的措辞建议：evidence 正文仍写“组件消融支持两类记忆结合的优势”。它与相邻的“不是各模块可相加的独立因果收益”限定一起使用时不会构成事实错误；若要完全消除因果联想，可改成“组件消融显示两类记忆在该设置下的互补性能差异”。

复核方式：重新导入 `.mjs` 成功，并检查了 settings 字段、Table 1/3 provenance、config noteKind、机制解读和 reproduction 文案；未重复执行逐数核对，也未修改实现或其他文件。
