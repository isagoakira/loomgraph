// ForecastCompass concept figures.
// This module is additive: all node identities and source metadata come from
// knowledge-structure-pilot-data.mjs; the SVGs only choose a visual arrangement.
import {
  atoms,
  edges,
  steps,
  results,
  ablation,
} from "../docs/examples/forecastcompass/knowledge-structure-pilot-data.mjs";

const atomById = new Map(atoms.map(atom => [atom.id, atom]));
const edgeById = new Map(edges.map(edge => [edge.id, edge]));
const stepById = new Map(steps.map(step => [step.id, step]));

const STEP_ORDER = [
  "probability",
  "signal-confidence",
  "memory-problem",
  "two-memories",
  "inference",
  "update",
  "evidence",
  "reproduction",
];

const PALETTE = {
  ink: "#26332d",
  muted: "#607069",
  line: "#6e8175",
  boundary: "#b6c8b8",
  paper: "#fbfaf4",
  green: "#e4f0e4",
  blue: "#e5eef6",
  gold: "#f4ecd9",
  rose: "#f4e3df",
  lavender: "#ece7f5",
  white: "#ffffff",
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

const atom = id => {
  const value = atomById.get(id);
  if (!value) throw new Error(`Unknown knowledge atom: ${id}`);
  return value;
};

const edge = id => {
  const value = edgeById.get(id);
  if (!value) throw new Error(`Unknown knowledge edge: ${id}`);
  return value;
};

const sourceFor = atomId => atom(atomId).source;
const sourceKindFor = atomId => atom(atomId).sourceKind;

const part = (id, atomId, box, meaning, options = {}) => ({
  id,
  atomId,
  box,
  meaning,
  label: options.label ?? options.display ?? atom(atomId).title,
  display: options.display ?? options.label ?? atom(atomId).title,
  note: options.note ?? "",
  kind: options.kind ?? "node",
  visualRole: options.visualRole ?? "concept",
  edgeIds: options.edgeIds ?? [],
  source: sourceFor(atomId),
  sourceKind: options.sourceKind ?? sourceKindFor(atomId),
});

const figure = ({
  id,
  stepId,
  title,
  width = 760,
  height,
  caption,
  diagramKind,
  annotation,
  parts,
  renderer,
}) => {
  if (!stepById.has(stepId)) throw new Error(`Unknown figure step: ${stepId}`);
  return {
    id,
    stepId,
    title,
    width,
    height,
    caption,
    diagramKind,
    annotation,
    parts,
    atomIds: [...new Set(parts.map(item => item.atomId))],
    sourceKinds: [...new Set(parts.map(item => item.sourceKind))],
    source: [...new Set(parts.map(item => item.source))].join("；"),
    sourceKind: [...new Set(parts.map(item => item.sourceKind))].length === 1
      ? [...new Set(parts.map(item => item.sourceKind))][0]
      : "mixed",
    renderer,
  };
};

const figures = [
  figure({
    id: "figure-probability",
    stepId: "probability",
    title: "从待预测问题到概率分配",
    height: 350,
    diagramKind: "时间边界与概率分配示意",
    caption: "图解示意：问题和 Agent 在结果揭晓前工作，右侧用两个候选结果演示概率分配；70%/30% 不是论文实验值。",
    annotation: "讲解示意，不是论文界面或本机预测结果。",
    renderer: "probability",
    parts: [
      part("question", "forecast-question", [30, 102, 170, 94], "明确尚未揭晓的问题和候选结果。", {
        display: "待预测问题",
        note: "候选结果明确",
        edgeIds: ["e-question-agent"],
      }),
      part("agent", "agent", [244, 102, 174, 94], "在时间有效证据内搜证、组织推理并输出概率。", {
        display: "Agent",
        note: "搜证 + 推理",
        edgeIds: ["e-question-agent", "e-agent-probability"],
      }),
      part("probability", "probability", [466, 64, 264, 172], "给每个候选结果分配非负概率，合计为 1。", {
        display: "概率预测",
        note: "讲解例：70% / 30%",
        edgeIds: ["e-agent-probability"],
      }),
      part("protocol", "protocol", [30, 260, 700, 72], "限定当前预测只能使用结果揭晓前已经可获得的信息。", {
        display: "时间边界：结果揭晓前可用证据",
        note: "结果后信息留给复盘",
        edgeIds: ["e-protocol-question", "e-protocol-trajectory"],
        kind: "boundary",
      }),
    ],
  }),
  figure({
    id: "figure-signal-confidence",
    stepId: "signal-confidence",
    title: "信号、信心与校准",
    height: 355,
    diagramKind: "证据信号到校准判断示意",
    caption: "图解示意：当前信号影响判断依据，概率分布提取最大候选概率作为信心，校准比较信心与实际正确率。",
    annotation: "信号不自动等于答案；所有信号都受时间协议约束。",
    renderer: "signal-confidence",
    parts: [
      part("signal", "signal", [30, 82, 204, 110], "当前证据中需要检查适用范围的信号维度。", {
        display: "当前证据信号",
        note: "看到了什么？",
        edgeIds: ["e-protocol-signal", "e-signal-calibration"],
      }),
      part("confidence", "confidence", [278, 68, 192, 126], "一次预测分布中的最大候选概率。", {
        display: "预测信心",
        note: "最大概率",
        edgeIds: ["e-probability-confidence", "e-confidence-calibration"],
      }),
      part("calibration", "calibration", [514, 58, 216, 146], "一组预测的信心是否与实际正确率匹配。", {
        display: "校准判断",
        note: "信心 ↔ 正确率",
        edgeIds: ["e-signal-calibration", "e-confidence-calibration"],
      }),
      part("protocol", "protocol", [30, 258, 700, 72], "当前信号必须来自结果揭晓前已经可获得的证据。", {
        display: "时间边界",
        note: "不把结果后信息倒灌进预测",
        edgeIds: ["e-protocol-signal"],
        kind: "boundary",
      }),
    ],
  }),
  figure({
    id: "figure-memory-problem",
    stepId: "memory-problem",
    title: "从一次结果记录到可复用原则",
    height: 390,
    diagramKind: "经验抽象为两类原则示意",
    caption: "图解示意：一次结果后记录被抽象成“看什么”和“信多少”两类原则，再由 FoCo 组织和修订。",
    annotation: "两类原则是教学分工；不表示论文把它们做成可独立相加的因果模块。",
    renderer: "memory-problem",
    parts: [
      part("record", "lesson", [30, 108, 162, 88], "用于讲解经验抽象的已揭晓个例：从看到的信号与实际结果中提炼未来可复用的原则。此部件引用可复用原则，未提前引入完整复盘轨迹。", {
        display: "一次结果记录",
        note: "讲解个例",
        edgeIds: [],
        kind: "example",
        visualRole: "supporting_example",
        sourceKind: "example",
      }),
      part("signal", "signal", [246, 42, 194, 110], "从记录中抽象未来搜证时要检查的证据维度。", {
        display: "看什么：信号",
        note: "证据检查原则",
        edgeIds: ["e-signal-lesson"],
      }),
      part("calibration", "calibration", [246, 170, 194, 90], "从记录中抽象未来怎样控制信心的原则。", {
        display: "信多少：校准",
        note: "信心控制原则",
        edgeIds: ["e-calibration-lesson"],
      }),
      part("lesson", "lesson", [500, 88, 224, 132], "把一次记录压缩成能服务未来问题的可复用原则。", {
        display: "可复用原则",
        note: "不是旧答案副本",
        edgeIds: ["e-signal-lesson", "e-calibration-lesson", "e-lesson-foco"],
      }),
      part("foco", "foco", [270, 294, 250, 72], "组织并修订预测专用记忆的方法入口。", {
        display: "FoCo：组织与修订",
        note: "接入未来问题",
        edgeIds: ["e-lesson-foco", "e-foco-taxonomy"],
      }),
      part("protocol", "protocol", [30, 294, 205, 72], "经验只能从当时允许的时间信息中提炼。", {
        display: "守住时间边界",
        note: "结果后材料服务未来",
        edgeIds: ["e-protocol-lesson"],
        kind: "boundary",
      }),
    ],
  }),
  figure({
    id: "figure-two-memories",
    stepId: "two-memories",
    title: "类别文件夹如何分出双记忆",
    height: 500,
    diagramKind: "分类索引与双记忆分枝示意",
    caption: "图解示意：按问题类别检索；同一子类别保存两份职责不同的 F/R 手册。文件夹与目录树是帮助理解分类索引的讲解例。",
    annotation: "讲解例：文件夹类比；不是论文 UI 截图或新增论文实体。",
    renderer: "two-memories",
    parts: [
      part("foco", "foco", [24, 178, 130, 110], "FoCo 组织预测专用记忆。", {
        display: "FoCo",
        note: "组织记忆",
        edgeIds: ["e-foco-taxonomy", "e-foco-memory"],
      }),
      part("taxonomy", "taxonomy", [184, 74, 200, 150], "层级预测分类法，用来组织可检索的任务类别。", {
        display: "任务分类法",
        note: "讲解例：文件夹",
        edgeIds: ["e-foco-taxonomy", "e-taxonomy-subcategory"],
      }),
      part("subcategory", "subcategory", [184, 300, 200, 120], "沿分类层级定位共享经验的具体子类别。", {
        display: "子类别",
        note: "记忆索引",
        edgeIds: ["e-taxonomy-subcategory", "e-subcategory-memory"],
      }),
      part("memory", "memory", [424, 166, 164, 132], "一个子类别对应的一份 F/R 双记忆状态。", {
        display: "双记忆状态",
        note: "F + R",
        edgeIds: ["e-foco-memory", "e-subcategory-memory", "e-memory-factor", "e-memory-reasoning"],
      }),
      part("factor", "factor", [620, 50, 116, 190], "F 记录要检查的信号、证据和常见误用。", {
        display: "F · 看什么",
        note: "因子记忆",
        edgeIds: ["e-memory-factor"],
      }),
      part("reasoning", "reasoning", [620, 280, 116, 190], "R 记录证据强弱、冲突和缺失如何改变信心。", {
        display: "R · 信多少",
        note: "推理记忆",
        edgeIds: ["e-memory-reasoning"],
      }),
    ],
  }),
  figure({
    id: "figure-inference",
    stepId: "inference",
    title: "双记忆进入一次新预测",
    height: 455,
    diagramKind: "F/R 两路进入搜证与概率示意",
    caption: "图解示意：子类别记忆分成 F 与 R 两路，分别影响搜证与概率信心；Agent 在时间边界内留下预测轨迹。",
    annotation: "图中箭头是方法输入/输出关系，不是把 F/R 声称成独立可加模块。",
    renderer: "inference",
    parts: [
      part("memory", "memory", [28, 154, 136, 92], "子类别索引到的 F/R 双记忆状态。", {
        display: "双记忆",
        note: "取回 M",
        edgeIds: ["e-memory-factor", "e-memory-reasoning", "e-memory-agent"],
      }),
      part("factor", "factor", [204, 48, 136, 82], "F 提示要看哪些信号和怎样核对证据。", {
        display: "F · 看什么",
        note: "搜证提示",
        edgeIds: ["e-memory-factor", "e-factor-signal", "e-factor-trajectory"],
      }),
      part("signal", "signal", [382, 48, 136, 82], "当前搜证中需要检查的证据维度。", {
        display: "当前信号",
        note: "查证据",
        edgeIds: ["e-factor-signal", "e-signal-calibration"],
      }),
      part("reasoning", "reasoning", [204, 258, 136, 82], "R 提示证据强弱、冲突和缺失怎样改变信心。", {
        display: "R · 信多少",
        note: "概率推理",
        edgeIds: ["e-memory-reasoning", "e-reasoning-probability"],
      }),
      part("agent", "agent", [382, 232, 136, 92], "Agent 综合当时可用证据与记忆形成预测。", {
        display: "Agent",
        note: "搜证 + 推理",
        edgeIds: ["e-memory-agent", "e-agent-trajectory", "e-agent-probability"],
      }),
      part("trajectory", "trajectory", [566, 48, 166, 94], "保留结果揭晓前的搜证、解释与判断过程。", {
        display: "预测轨迹",
        note: "结果前记录",
        edgeIds: ["e-agent-trajectory", "e-factor-trajectory", "e-protocol-trajectory"],
      }),
      part("probability", "probability", [566, 232, 166, 94], "输出候选结果的完整概率分布。", {
        display: "概率分布",
        note: "结果前答案",
        edgeIds: ["e-agent-probability", "e-reasoning-probability", "e-trajectory-probability"],
      }),
      part("protocol", "protocol", [28, 370, 704, 72], "预测只能使用结果揭晓前可获得的信息。", {
        display: "时间协议",
        note: "当前信息边界",
        edgeIds: ["e-protocol-trajectory"],
        kind: "boundary",
      }),
    ],
  }),
  figure({
    id: "figure-update",
    stepId: "update",
    title: "结果前后双轨如何形成记忆修订",
    height: 445,
    diagramKind: "预测轨迹与复盘轨迹对照、诊断聚合、记忆修订示意",
    caption: "图解示意：结果揭晓切开两个信息阶段；复盘轨迹对照原预测，差异经诊断与聚合后局部写回未来记忆。",
    annotation: "结果后信息只作为学习信号，不能倒灌成原预测输入。",
    renderer: "update",
    parts: [
      part("protocol", "protocol", [24, 52, 712, 72], "守住结果前预测与结果后学习的时间边界。", {
        display: "时间边界：结果前预测 / 结果后学习",
        note: "不可倒灌",
        edgeIds: ["e-protocol-revision"],
        kind: "boundary",
      }),
      part("outcome", "outcome", [28, 145, 142, 82], "真实结果揭晓，才产生结果后复盘所需的信息。", {
        display: "结果揭晓",
        note: "信息阶段切换",
        edgeIds: ["e-outcome-retrospective"],
      }),
      part("trajectory", "trajectory", [214, 124, 194, 88], "结果揭晓前已经记录的搜证、解释和概率形成过程。", {
        display: "预测轨迹",
        note: "结果前",
        edgeIds: ["e-trajectory-retrospective", "e-trajectory-diagnosis"],
      }),
      part("retrospective", "retrospective", [214, 264, 194, 88], "结果揭晓后生成的复盘轨迹，只服务未来记忆学习。", {
        display: "复盘轨迹",
        note: "结果后",
        edgeIds: ["e-trajectory-retrospective", "e-retrospective-diagnosis", "e-retrospective-revision"],
      }),
      part("diagnosis", "diagnosis", [446, 130, 126, 82], "定位信号遗漏、因子误用或概率推理差异。", {
        display: "差异诊断",
        note: "拆分问题",
        edgeIds: ["e-trajectory-diagnosis", "e-retrospective-diagnosis", "e-diagnosis-aggregation"],
      }),
      part("aggregation", "aggregation", [446, 270, 126, 82], "从多条差异中留下反复出现且可复用的模式。", {
        display: "模式聚合",
        note: "过滤偶然偏差",
        edgeIds: ["e-diagnosis-aggregation", "e-aggregation-revision"],
      }),
      part("revision", "revision", [610, 130, 126, 82], "把聚合后的建议写回受影响的未来记忆内容。", {
        display: "局部修订",
        note: "只改相关内容",
        edgeIds: ["e-aggregation-revision", "e-revision-memory"],
      }),
      part("memory", "memory", [610, 270, 126, 82], "更新后的双记忆状态服务更晚的问题。", {
        display: "未来记忆",
        note: "供后续预测",
        edgeIds: ["e-revision-memory"],
      }),
    ],
  }),
  figure({
    id: "figure-evidence",
    stepId: "evidence",
    title: "Brier/ECE 两个评价视角与证据分层",
    width: 900,
    height: 510,
    diagramKind: "指标、主结果与消融证据示意",
    caption: "作者报告值：Table 1 的 FutureX 平均结果与 Table 3 的 GPT-5-mini/FutureX 消融均值；图中只复用已核验旧数组，不代表本机复现实验。",
    annotation: "Brier 看概率距离；ECE 看信心匹配；主结果与组件消融回答不同问题。",
    renderer: "evidence",
    parts: [
      part("probability", "probability", [24, 62, 154, 82], "完整概率分布是 Brier 的评价对象。", {
        display: "完整概率分布",
        note: "真实结果对应候选记为 1",
        edgeIds: ["e-brier-probability"],
      }),
      part("brier", "brier", [210, 50, 170, 98], "比较预测概率与真实结果的多类平方误差距离。", {
        display: "Brier · 概率距离",
        note: "完整分布的平方误差",
        edgeIds: ["e-brier-probability", "e-brier-comparison"],
      }),
      part("confidence", "confidence", [24, 190, 154, 82], "每次预测分布中的最大概率作为信心。", {
        display: "最大概率 = 信心",
        note: "ECE 的输入",
        edgeIds: ["e-ece-confidence"],
      }),
      part("ece", "ece", [210, 174, 170, 110], "按信心分箱比较经验正确率与平均信心。", {
        display: "ECE · 信心匹配",
        note: "最大信心的分箱匹配",
        edgeIds: ["e-ece-confidence", "e-ece-calibration", "e-ece-comparison"],
      }),
      part("calibration", "calibration", [210, 302, 170, 72], "校准关注信心与实际正确率是否匹配。", {
        display: "校准",
        note: "一组预测",
        edgeIds: ["e-ece-calibration"],
      }),
      part("comparison", "comparison", [412, 46, 142, 72], "把完整 FoCo、BASE、Static 和 F/R 消融放在同条件下比较。", {
        display: "同条件比较",
        note: "固定模型/数据/协议",
        edgeIds: ["e-brier-comparison", "e-ece-comparison", "e-comparison-table1", "e-comparison-table3"],
      }),
      part("base", "base", [408, 140, 82, 72], "无外部记忆的部署基线。", {
        display: "BASE",
        note: "无外部记忆",
        edgeIds: ["e-comparison-base"],
      }),
      part("static", "static", [500, 140, 82, 72], "保留初始记忆但不周更的对照。", {
        display: "Static",
        note: "不周更",
        edgeIds: ["e-comparison-static", "e-static-base"],
      }),
      part("ablation", "ablation", [408, 230, 174, 76], "分别去掉 F 或 R 的同条件组件对照。", {
        display: "F/R 消融",
        note: "去 F / 去 R",
        edgeIds: ["e-comparison-ablation", "e-ablation-factor", "e-ablation-reasoning"],
      }),
      part("table1", "table1-result", [650, 26, 220, 205], "Table 1 的跨评估周平均主结果。", {
        display: "Table 1 · 主结果",
        note: "总体均值",
        edgeIds: ["e-comparison-table1"],
      }),
      part("table3", "table3-ablation", [650, 252, 220, 236], "Table 3 的固定条件下逐周及平均 F/R 消融。", {
        display: "Table 3 · 消融",
        note: "FutureX / GPT-5-mini",
        edgeIds: ["e-comparison-table3"],
      }),
    ],
  }),
  figure({
    id: "figure-reproduction",
    stepId: "reproduction",
    title: "固定配置后分出独立实验臂",
    height: 420,
    diagramKind: "复现约束与比较版本示意",
    caption: "图解示意：先固定配置与时间协议，再把 BASE、FoCo (Static) 和 F/R 消融作为独立比较臂；原文缺项保持待核实。",
    annotation: "实验臂表示比较设计，不表示本图已经执行复现。",
    renderer: "reproduction",
    parts: [
      part("config", "config", [24, 92, 178, 122], "固定模型、数据、时间窗口、修订设置、指标和待核实项。", {
        display: "复现配置",
        note: "模型 / 数据 / 指标",
        edgeIds: ["e-config-protocol", "e-config-comparison"],
      }),
      part("protocol", "protocol", [24, 258, 178, 72], "固定结果前信息边界和结果后记忆更新顺序。", {
        display: "时间协议",
        note: "先定信息截止",
        edgeIds: ["e-config-protocol"],
        kind: "boundary",
      }),
      part("comparison", "comparison", [268, 146, 172, 88], "在相同模型、数据、协议和指标口径下比较版本。", {
        display: "同条件比较",
        note: "比较入口",
        edgeIds: ["e-config-comparison", "e-comparison-base", "e-comparison-static", "e-comparison-ablation"],
      }),
      part("base", "base", [500, 30, 226, 112], "不使用外部预测记忆的部署基线。", {
        display: "独立实验臂 · BASE",
        note: "无外部记忆",
        edgeIds: ["e-comparison-base"],
      }),
      part("static", "static", [500, 154, 226, 112], "保留初始化记忆、取消每周更新的对照。", {
        display: "独立实验臂 · FoCo (Static)",
        note: "初始记忆，不周更",
        edgeIds: ["e-comparison-static"],
      }),
      part("ablation", "ablation", [500, 278, 226, 112], "分别去掉因子记忆 F 或推理记忆 R 的组件对照。", {
        display: "独立实验臂 · F/R 消融",
        note: "去 F / 去 R",
        edgeIds: ["e-comparison-ablation"],
      }),
    ],
  }),
];

const figureByStepId = new Map(figures.map(item => [item.stepId, item]));
const figureById = new Map(figures.map(item => [item.id, item]));

const text = (x, y, value, options = {}) => {
  const {
    size = 16,
    weight = 500,
    fill = PALETTE.ink,
    anchor = "start",
    family = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif",
  } = options;
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
};

const multiline = (x, y, lines, options = {}) => {
  const { gap = 22, ...textOptions } = options;
  return lines.map((line, index) => text(x, y + index * gap, line, textOptions)).join("");
};

const arrow = (x1, y1, x2, y2, label = "", options = {}) => {
  const {
    dashed = false,
    color = PALETTE.line,
    labelY = Math.min(y1, y2) - 8,
    curve = "",
  } = options;
  const line = curve
    ? `<path d="${curve}" fill="none" stroke="${color}" stroke-width="2.4" data-figure-relation="illustrative" ${dashed ? 'stroke-dasharray="7 6"' : ""} marker-end="url(#figure-arrow)"/>`
    : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.4" data-figure-relation="illustrative" ${dashed ? 'stroke-dasharray="7 6"' : ""} marker-end="url(#figure-arrow)"/>`;
  return `${line}${label ? text((x1 + x2) / 2, labelY, label, { size: 15, weight: 600, fill: color, anchor: "middle" }) : ""}`;
};

const connector = (x1, y1, x2, y2, label = "", options = {}) => arrow(x1, y1, x2, y2, label, options);

// Evidence links compare viewpoints rather than asserting a causal direction.
// Keep them visible as layout relations while deliberately omitting arrowheads.
const relationLine = (x1, y1, x2, y2, label = "", options = {}) => {
  const {
    dashed = false,
    color = PALETTE.line,
    labelY = Math.min(y1, y2) - 8,
    curve = "",
  } = options;
  const line = curve
    ? `<path d="${curve}" fill="none" stroke="${color}" stroke-width="2.4" data-figure-relation="illustrative" ${dashed ? 'stroke-dasharray="7 6"' : ""}/>`
    : `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.4" data-figure-relation="illustrative" ${dashed ? 'stroke-dasharray="7 6"' : ""}/>`;
  return `${line}${label ? text((x1 + x2) / 2, labelY, label, { size: 15, weight: 600, fill: color, anchor: "middle" }) : ""}`;
};

const panel = (x, y, w, h, options = {}) => {
  const { fill = PALETTE.paper, stroke = PALETTE.boundary, dash = "" } = options;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" stroke="${stroke}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
};

const interactive = (fig, partValue, content, label = partValue.meaning) => {
  const atomValue = atom(partValue.atomId);
  const accessibleLabel = `${partValue.display}：${label}`;
  return `<g id="${esc(`${fig.id}-${partValue.id}`)}" data-figure-atom="${esc(partValue.atomId)}" data-figure-step="${esc(fig.stepId)}" data-figure-part="${esc(partValue.id)}" role="button" tabindex="0" aria-label="${esc(accessibleLabel)}"><title>${esc(`${atomValue.title}：${label}`)}</title>${content}</g>`;
};

const node = (fig, partValue, options = {}) => {
  const [x, y, w, h] = partValue.box;
  const {
    fill = PALETTE.green,
    stroke = PALETTE.line,
    radius = 16,
    titleSize = 18,
    noteSize = 15,
    titleY = y + 27,
    noteY = y + h - 18,
    titleAnchor = "middle",
    titleX = x + w / 2,
    noteX = x + w / 2,
    noteAnchor = "middle",
  } = options;
  const title = text(titleX, titleY, partValue.display, { size: titleSize, weight: 700, anchor: titleAnchor });
  const note = partValue.note ? text(noteX, noteY, partValue.note, { size: noteSize, fill: PALETTE.muted, anchor: noteAnchor }) : "";
  return interactive(fig, partValue, `${panel(x, y, w, h, { fill, stroke })}${title}${note}`);
};

const boundary = (fig, partValue, options = {}) => {
  const [x, y, w, h] = partValue.box;
  const title = text(x + 18, y + 27, partValue.display, { size: 17, weight: 700 });
  const note = partValue.note ? text(x + 18, y + h - 18, partValue.note, { size: 15, fill: PALETTE.muted }) : "";
  return interactive(fig, partValue, `${panel(x, y, w, h, { fill: options.fill ?? PALETTE.gold, stroke: options.stroke ?? PALETTE.line, dash: "8 6" })}${title}${note}`);
};

const getPart = (fig, id) => {
  const value = fig.parts.find(item => item.id === id);
  if (!value) throw new Error(`Figure ${fig.id} has no part ${id}`);
  return value;
};

const renderProbability = fig => {
  const question = getPart(fig, "question");
  const agent = getPart(fig, "agent");
  const probability = getPart(fig, "probability");
  const protocol = getPart(fig, "protocol");
  const [px, py, pw, ph] = probability.box;
  const bars = [
    `<rect x="${px + 24}" y="${py + 68}" width="${Math.round((pw - 52) * 0.70)}" height="22" rx="8" fill="#8fb896"/>`,
    `<rect x="${px + 24}" y="${py + 112}" width="${Math.round((pw - 52) * 0.30)}" height="22" rx="8" fill="#d5a982"/>`,
    text(px + 24, py + 62, "X 赢", { size: 16, weight: 700 }),
    text(px + 24 + (pw - 52) * 0.70 + 12, py + 85, "70%", { size: 16, weight: 700 }),
    text(px + 24, py + 106, "X 输", { size: 16, weight: 700 }),
    text(px + 24 + (pw - 52) * 0.30 + 12, py + 129, "30%", { size: 16, weight: 700 }),
    text(px + 24, py + 157, "讲解例：70% / 30%，非论文值", { size: 15, fill: PALETTE.muted }),
  ].join("");
  return [
    text(30, 34, "先确定问题与信息时点，再把不确定性写成分布", { size: 20, weight: 700 }),
    connector(question.box[0] + question.box[2], question.box[1] + 47, agent.box[0], agent.box[1] + 47, "围绕问题搜证", { labelY: 92 }),
    connector(agent.box[0] + agent.box[2], agent.box[1] + 47, probability.box[0], probability.box[1] + 58, "输出分布", { labelY: 54 }),
    node(fig, question, { fill: PALETTE.blue }),
    node(fig, agent, { fill: PALETTE.green }),
    interactive(fig, probability, `${panel(px, py, pw, ph, { fill: PALETTE.white })}${text(px + 18, py + 31, probability.display, { size: 18, weight: 700 })}${bars}`),
    boundary(fig, protocol),
  ].join("");
};

const renderSignalConfidence = fig => {
  const signal = getPart(fig, "signal");
  const confidence = getPart(fig, "confidence");
  const calibration = getPart(fig, "calibration");
  const protocol = getPart(fig, "protocol");
  const [cx, cy, cw, ch] = confidence.box;
  const [kx, ky, kw, kh] = calibration.box;
  const dots = Array.from({ length: 10 }, (_, index) => {
    const hit = index < 7;
    return `<circle cx="${cx + 25 + index * 15}" cy="${cy + 72}" r="6" fill="${hit ? "#8fb896" : "#f4e3df"}" stroke="${PALETTE.ink}" stroke-width="1.4"/>`;
  }).join("");
  const gauge = [
    dots,
    text(cx + 18, cy + 101, "0", { size: 15, fill: PALETTE.muted }),
    text(cx + cw - 18, cy + 101, "10", { size: 15, fill: PALETTE.muted, anchor: "end" }),
    text(cx + 18, cy + 119, "7/10 命中 ≈ 70%（讲解示意）", { size: 15, weight: 600, fill: PALETTE.muted }),
  ].join("");
  const bins = [0, 1, 2, 3].map(index => `<rect x="${kx + 24 + index * 40}" y="${ky + 82}" width="30" height="30" rx="6" fill="${index < 2 ? '#e4f0e4' : '#f4e3df'}" stroke="${PALETTE.line}" stroke-width="1.5"/>`).join("");
  const calibrationBody = `${panel(kx, ky, kw, kh, { fill: PALETTE.lavender })}${text(kx + 18, ky + 31, calibration.display, { size: 18, weight: 700 })}${bins}${text(kx + 24, ky + 135, "正确率与信心是否匹配", { size: 15, fill: PALETTE.muted })}`;
  return [
    text(30, 34, "证据影响判断，但信心还要接受一组预测的校准检查", { size: 20, weight: 700 }),
    connector(signal.box[0] + signal.box[2], signal.box[1] + 55, confidence.box[0], confidence.box[1] + 55, "进入判断", { labelY: 72 }),
    connector(confidence.box[0] + confidence.box[2], confidence.box[1] + 55, calibration.box[0], calibration.box[1] + 55, "检查匹配", { labelY: 230 }),
    node(fig, signal, { fill: PALETTE.blue }),
    interactive(fig, confidence, `${panel(cx, cy, cw, ch, { fill: PALETTE.green })}${text(cx + 18, cy + 31, confidence.display, { size: 18, weight: 700 })}${gauge}`),
    interactive(fig, calibration, calibrationBody),
    boundary(fig, protocol),
  ].join("");
};

const renderMemoryProblem = fig => {
  const record = getPart(fig, "record");
  const signal = getPart(fig, "signal");
  const calibration = getPart(fig, "calibration");
  const lesson = getPart(fig, "lesson");
  const foco = getPart(fig, "foco");
  const protocol = getPart(fig, "protocol");
  const [rx, ry, rw, rh] = record.box;
  const [sx, sy, sw, sh] = signal.box;
  const [cx, cy, cw, ch] = calibration.box;
  const [lx, ly, lw, lh] = lesson.box;
  const recordBody = [
    panel(rx, ry, rw, rh, { fill: PALETTE.rose }),
    text(rx + 14, ry + 24, record.display, { size: 17, weight: 700 }),
    `<rect x="${rx + 14}" y="${ry + 38}" width="${rw - 28}" height="38" rx="8" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    `<circle cx="${rx + 27}" cy="${ry + 51}" r="4" fill="#8fb896"/>`,
    text(rx + 38, ry + 56, "看到的信号", { size: 15, fill: PALETTE.ink }),
    `<circle cx="${rx + 27}" cy="${ry + 69}" r="4" fill="#d5a982"/>`,
    text(rx + 38, ry + 74, "实际结果", { size: 15, fill: PALETTE.ink }),
  ].join("");
  const signalBody = [
    panel(sx, sy, sw, sh, { fill: PALETTE.blue }),
    text(sx + 14, sy + 24, signal.display, { size: 17, weight: 700 }),
    `<rect x="${sx + 14}" y="${sy + 38}" width="${sw - 28}" height="66" rx="8" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    `<path d="M${sx + 26} ${sy + 50} h10 M${sx + 26} ${sy + 78} h10" stroke="${PALETTE.line}" stroke-width="2"/>`,
    text(sx + 44, sy + 62, "覆盖与时间", { size: 15 }),
    text(sx + 44, sy + 90, "定义与适用", { size: 15 }),
  ].join("");
  const calibrationBody = [
    panel(cx, cy, cw, ch, { fill: PALETTE.lavender }),
    text(cx + 14, cy + 24, calibration.display, { size: 17, weight: 700 }),
    text(cx + 14, cy + 51, "弱证据", { size: 15 }),
    `<rect x="${cx + 72}" y="${cy + 41}" width="${cw - 88}" height="10" rx="5" fill="#d5a982"/>`,
    text(cx + 14, cy + 73, "冲突 / 缺失", { size: 15 }),
    `<rect x="${cx + 72}" y="${cy + 63}" width="${cw - 88}" height="10" rx="5" fill="#c8b6d8"/>`,
  ].join("");
  const lessonBody = [
    panel(lx, ly, lw, lh, { fill: PALETTE.gold }),
    text(lx + 16, ly + 27, lesson.display, { size: 18, weight: 700 }),
    `<rect x="${lx + 16}" y="${ly + 42}" width="${lw - 32}" height="30" rx="8" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    text(lx + 28, ly + 62, "检查什么：证据清单", { size: 15 }),
    `<rect x="${lx + 16}" y="${ly + 78}" width="${lw - 32}" height="30" rx="8" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    text(lx + 28, ly + 98, "控制信心：适度更新", { size: 15 }),
    text(lx + 16, ly + 115, "不是旧答案副本", { size: 15, fill: PALETTE.muted }),
  ].join("");
  return [
    text(30, 34, "保存一次答案还不够：要抽象未来如何搜证与控制信心", { size: 20, weight: 700 }),
    connector(record.box[0] + record.box[2], record.box[1] + 44, signal.box[0], signal.box[1] + 44, "抽象", { labelY: 136 }),
    connector(record.box[0] + record.box[2], record.box[1] + 44, calibration.box[0], calibration.box[1] + 44, "抽象", { labelY: 252 }),
    connector(signal.box[0] + signal.box[2], signal.box[1] + 45, lesson.box[0], lesson.box[1] + 47, "原则 1", { labelY: 75 }),
    connector(calibration.box[0] + calibration.box[2], calibration.box[1] + 45, lesson.box[0], lesson.box[1] + 90, "原则 2", { labelY: 244 }),
    connector(lesson.box[0] + 112, lesson.box[1] + lesson.box[3], foco.box[0] + 125, foco.box[1], "组织 / 修订", { labelY: 282 }),
    connector(protocol.box[0] + protocol.box[2], protocol.box[1] + 24, lesson.box[0], lesson.box[1] + lesson.box[3] + 18, "守时序", { dashed: true, labelY: 286 }),
    interactive(fig, record, recordBody),
    interactive(fig, signal, signalBody),
    interactive(fig, calibration, calibrationBody),
    interactive(fig, lesson, lessonBody),
    node(fig, foco, { fill: PALETTE.green, titleSize: 17, noteSize: 15 }),
    boundary(fig, protocol, { fill: PALETTE.paper }),
  ].join("");
};

const renderTwoMemories = fig => {
  const foco = getPart(fig, "foco");
  const taxonomy = getPart(fig, "taxonomy");
  const subcategory = getPart(fig, "subcategory");
  const memory = getPart(fig, "memory");
  const factor = getPart(fig, "factor");
  const reasoning = getPart(fig, "reasoning");
  const [fx, fy, fw, fh] = foco.box;
  const [tx, ty, tw, th] = taxonomy.box;
  const [sx, sy, sw, sh] = subcategory.box;
  const [mx, my, mw, mh] = memory.box;
  const [facx, facy, facw, fach] = factor.box;
  const [rx, ry, rw, rh] = reasoning.box;
  const focoBody = [
    panel(fx, fy, fw, fh, { fill: PALETTE.green }),
    text(fx + 14, fy + 26, "FoCo", { size: 18, weight: 700 }),
    text(fx + 14, fy + 50, "组织记忆", { size: 15, fill: PALETTE.muted }),
    `<rect x="${fx + 14}" y="${fy + 61}" width="${fw - 28}" height="16" rx="5" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    text(fx + 23, fy + 73, "分类索引", { size: 15 }),
    `<rect x="${fx + 14}" y="${fy + 82}" width="${fw - 28}" height="16" rx="5" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    text(fx + 23, fy + 94, "记忆修订", { size: 15 }),
  ].join("");
  const taxonomyBody = [
    panel(tx, ty, tw, th, { fill: PALETTE.blue }),
    `<path d="M${tx + 14} ${ty + 29} V${ty + 18} Q${tx + 14} ${ty + 10} ${tx + 22} ${ty + 10} H${tx + 72} L${tx + 84} ${ty + 22} H${tx + tw - 14} V${ty + 29} Z" fill="#d6e5ef" stroke="${PALETTE.line}" stroke-width="1.8"/>`,
    text(tx + 18, ty + 49, "任务分类法", { size: 17, weight: 700 }),
    `<path d="M${tx + 26} ${ty + 65} V${ty + 116} M${tx + 26} ${ty + 79} H${tx + 45} M${tx + 26} ${ty + 101} H${tx + 45}" fill="none" stroke="${PALETTE.line}" stroke-width="2"/>`,
    text(tx + 54, ty + 84, "类别", { size: 15 }),
    `<rect x="${tx + 45}" y="${ty + 91}" width="${tw - 61}" height="24" rx="6" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    text(tx + 54, ty + 108, "子类别", { size: 15, weight: 600 }),
    text(tx + 18, ty + 133, "讲解例：文件夹", { size: 15, fill: PALETTE.muted }),
  ].join("");
  const subcategoryBody = [
    panel(sx, sy, sw, sh, { fill: PALETTE.blue }),
    `<path d="M${sx + 14} ${sy + 27} V${sy + 17} Q${sx + 14} ${sy + 9} ${sx + 22} ${sy + 9} H${sx + 69} L${sx + 81} ${sy + 21} H${sx + sw - 14} V${sy + 27} Z" fill="#d6e5ef" stroke="${PALETTE.line}" stroke-width="1.8"/>`,
    text(sx + 18, sy + 48, "预测子类别", { size: 17, weight: 700 }),
    `<path d="M${sx + 25} ${sy + 62} V${sy + 92} H${sx + 42}" fill="none" stroke="${PALETTE.line}" stroke-width="2"/>`,
    `<rect x="${sx + 42}" y="${sy + 66}" width="${sw - 58}" height="26" rx="6" fill="${PALETTE.white}" stroke="${PALETTE.boundary}"/>`,
    text(sx + 52, sy + 84, "美国总统选举", { size: 15 }),
    text(sx + 18, sy + 102, "讲解例 · 记忆索引", { size: 15, fill: PALETTE.muted }),
  ].join("");
  const memoryBody = [
    panel(mx, my, mw, mh, { fill: PALETTE.gold }),
    text(mx + 14, my + 27, "双记忆状态", { size: 18, weight: 700 }),
    text(mx + 14, my + 50, "同一子类别", { size: 15, fill: PALETTE.muted }),
    `<rect x="${mx + 14}" y="${my + 61}" width="${mw - 28}" height="24" rx="7" fill="${PALETTE.green}" stroke="${PALETTE.line}"/>`,
    text(mx + 25, my + 78, "F · 看什么", { size: 15, weight: 700 }),
    `<rect x="${mx + 14}" y="${my + 92}" width="${mw - 28}" height="24" rx="7" fill="${PALETTE.lavender}" stroke="${PALETTE.line}"/>`,
    text(mx + 25, my + 109, "R · 信多少", { size: 15, weight: 700 }),
  ].join("");
  const factorBody = [
    panel(facx, facy, facw, fach, { fill: PALETTE.green }),
    text(facx + 14, facy + 26, "F · 看什么", { size: 17, weight: 700 }),
    text(facx + 14, facy + 48, "因子记忆", { size: 15, fill: PALETTE.muted }),
    `<circle cx="${facx + 28}" cy="${facy + 76}" r="13" fill="none" stroke="${PALETTE.line}" stroke-width="2.5"/><line x1="${facx + 38}" y1="${facy + 86}" x2="${facx + 48}" y2="${facy + 96}" stroke="${PALETTE.line}" stroke-width="2.5"/>`,
    text(facx + 54, facy + 82, "信号", { size: 15 }),
    text(facx + 54, facy + 106, "证据", { size: 15 }),
    text(facx + 54, facy + 130, "误用", { size: 15 }),
    `<path d="M${facx + 16} ${facy + 148} h8 l4 5 l8 -10" fill="none" stroke="${PALETTE.line}" stroke-width="2"/>`,
    text(facx + 42, facy + 153, "检查清单", { size: 15, fill: PALETTE.muted }),
  ].join("");
  const reasoningBody = [
    panel(rx, ry, rw, rh, { fill: PALETTE.lavender }),
    text(rx + 14, ry + 26, "R · 信多少", { size: 17, weight: 700 }),
    text(rx + 14, ry + 48, "推理记忆", { size: 15, fill: PALETTE.muted }),
    `<line x1="${rx + 18}" y1="${ry + 78}" x2="${rx + rw - 18}" y2="${ry + 78}" stroke="${PALETTE.line}" stroke-width="3"/>`,
    [0, 1, 2, 3].map(index => `<line x1="${rx + 20 + index * 25}" y1="${ry + 71}" x2="${rx + 20 + index * 25}" y2="${ry + 85}" stroke="${PALETTE.line}" stroke-width="2"/>`).join(""),
    text(rx + 18, ry + 103, "弱", { size: 15, fill: PALETTE.muted }),
    text(rx + rw - 18, ry + 103, "强", { size: 15, fill: PALETTE.muted, anchor: "end" }),
    text(rx + 14, ry + 130, "证据强弱", { size: 15 }),
    text(rx + 14, ry + 153, "冲突 / 缺失", { size: 15 }),
    text(rx + 14, ry + 176, "信心区间", { size: 15, fill: PALETTE.muted }),
  ].join("");
  return [
    text(24, 32, "从分类索引进入同一子类别的两份手册", { size: 20, weight: 700 }),
    connector(foco.box[0] + foco.box[2], foco.box[1] + 55, taxonomy.box[0], taxonomy.box[1] + 44, "组织", { labelY: 154 }),
    connector(taxonomy.box[0] + 100, taxonomy.box[1] + taxonomy.box[3], subcategory.box[0] + 100, subcategory.box[1], "细分", { labelY: 270 }),
    connector(subcategory.box[0] + subcategory.box[2], subcategory.box[1] + 48, memory.box[0], memory.box[1] + 64, "索引", { labelY: 332 }),
    connector(memory.box[0] + memory.box[2], memory.box[1] + 42, factor.box[0], factor.box[1] + 90, "F", { labelY: 150 }),
    connector(memory.box[0] + memory.box[2], memory.box[1] + 90, reasoning.box[0], reasoning.box[1] + 90, "R", { labelY: 355 }),
    interactive(fig, foco, focoBody),
    interactive(fig, taxonomy, taxonomyBody),
    interactive(fig, subcategory, subcategoryBody),
    interactive(fig, memory, memoryBody),
    interactive(fig, factor, factorBody),
    interactive(fig, reasoning, reasoningBody),
    text(24, 486, "按问题类别检索；同一子类别保存两份职责不同的手册。", { size: 15, fill: PALETTE.muted }),
  ].join("");
};

const renderInference = fig => {
  const memory = getPart(fig, "memory");
  const factor = getPart(fig, "factor");
  const signal = getPart(fig, "signal");
  const reasoning = getPart(fig, "reasoning");
  const agent = getPart(fig, "agent");
  const trajectory = getPart(fig, "trajectory");
  const probability = getPart(fig, "probability");
  const protocol = getPart(fig, "protocol");
  return [
    text(28, 34, "F 引导搜什么，R 引导信多少，Agent 留下预测过程", { size: 20, weight: 700 }),
    connector(memory.box[0] + memory.box[2], memory.box[1] + 30, factor.box[0], factor.box[1] + 40, "F", { labelY: 130 }),
    connector(memory.box[0] + memory.box[2], memory.box[1] + 63, reasoning.box[0], reasoning.box[1] + 40, "R", { labelY: 278 }),
    connector(factor.box[0] + factor.box[2], factor.box[1] + 41, signal.box[0], signal.box[1] + 41, "看什么", { labelY: 146 }),
    connector(signal.box[0] + signal.box[2], signal.box[1] + 41, agent.box[0], agent.box[1] + 45, "带入搜证", { labelY: 188 }),
    connector(reasoning.box[0] + reasoning.box[2], reasoning.box[1] + 41, agent.box[0], agent.box[1] + 45, "信多少", { labelY: 220 }),
    connector(agent.box[0] + agent.box[2], agent.box[1] + 30, trajectory.box[0], trajectory.box[1] + 47, "保留过程", { labelY: 205 }),
    connector(agent.box[0] + agent.box[2], agent.box[1] + 64, probability.box[0], probability.box[1] + 47, "输出分布", { labelY: 354 }),
    node(fig, memory, { fill: PALETTE.gold }),
    node(fig, factor, { fill: PALETTE.green, titleSize: 17 }),
    node(fig, signal, { fill: PALETTE.blue, titleSize: 17 }),
    node(fig, reasoning, { fill: PALETTE.lavender, titleSize: 17 }),
    node(fig, agent, { fill: PALETTE.green }),
    node(fig, trajectory, { fill: PALETTE.blue, titleSize: 17 }),
    node(fig, probability, { fill: PALETTE.rose, titleSize: 17 }),
    boundary(fig, protocol, { fill: PALETTE.paper }),
  ].join("");
};

const renderUpdate = fig => {
  const protocol = getPart(fig, "protocol");
  const outcome = getPart(fig, "outcome");
  const trajectory = getPart(fig, "trajectory");
  const retrospective = getPart(fig, "retrospective");
  const diagnosis = getPart(fig, "diagnosis");
  const aggregation = getPart(fig, "aggregation");
  const revision = getPart(fig, "revision");
  const memory = getPart(fig, "memory");
  const [tx, ty, tw, th] = trajectory.box;
  const [rx, ry, rw, rh] = retrospective.box;
  return [
    text(24, 34, "结果揭晓切开两个信息阶段，差异才可进入记忆修订", { size: 20, weight: 700 }),
    `<line x1="190" y1="136" x2="190" y2="400" stroke="${PALETTE.boundary}" stroke-width="2" stroke-dasharray="8 6"/>`,
    text(190, 410, "结果揭晓", { size: 15, fill: PALETTE.muted, anchor: "middle" }),
    connector(outcome.box[0] + outcome.box[2], outcome.box[1] + 42, retrospective.box[0], retrospective.box[1] + 42, "触发", { labelY: 215 }),
    connector(retrospective.box[0] + 60, retrospective.box[1], trajectory.box[0] + 60, trajectory.box[1] + trajectory.box[3], "对照原预测", { curve: `M${rx + 60} ${ry} C${rx + 22} ${ry - 28}, ${tx + 22} ${ty + th + 28}, ${tx + 60} ${ty + th}`, labelY: 230 }),
    connector(trajectory.box[0] + trajectory.box[2], trajectory.box[1] + 42, diagnosis.box[0], diagnosis.box[1] + 41, "提供基线", { labelY: 88 }),
    connector(retrospective.box[0] + retrospective.box[2], retrospective.box[1] + 42, diagnosis.box[0], diagnosis.box[1] + 41, "提供结果后对照", { labelY: 220 }),
    connector(diagnosis.box[0] + diagnosis.box[2], diagnosis.box[1] + 41, aggregation.box[0], aggregation.box[1] + 41, "汇总差异", { labelY: 214 }),
    connector(aggregation.box[0] + aggregation.box[2], aggregation.box[1] + 41, revision.box[0], revision.box[1] + 41, "形成建议", { labelY: 214 }),
    connector(revision.box[0] + revision.box[2], revision.box[1] + 41, memory.box[0], memory.box[1] + 41, "局部写回", { labelY: 214 }),
    boundary(fig, protocol),
    node(fig, outcome, { fill: PALETTE.rose }),
    node(fig, trajectory, { fill: PALETTE.blue, titleSize: 17 }),
    node(fig, retrospective, { fill: PALETTE.rose, titleSize: 17 }),
    node(fig, diagnosis, { fill: PALETTE.gold, titleSize: 17 }),
    node(fig, aggregation, { fill: PALETTE.gold, titleSize: 17 }),
    node(fig, revision, { fill: PALETTE.lavender, titleSize: 17 }),
    node(fig, memory, { fill: PALETTE.green, titleSize: 17 }),
  ].join("");
};

const table1FutureX = Object.fromEntries(
  results
    .filter(item => item.configId === "gpt-futurex" && ["BASE", "FoCo (Static)", "FoCo"].includes(item.method))
    .map(item => [item.method, { brier: item.brier, ece: item.ece }]),
);

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const table3FutureX = Object.fromEntries(
  ablation.map(item => [item.method, { brier: mean(item.brier), ece: mean(item.ece) }]),
);

const fixed = value => Number(value).toFixed(3);

const renderEvidence = fig => {
  const probability = getPart(fig, "probability");
  const brier = getPart(fig, "brier");
  const confidence = getPart(fig, "confidence");
  const ece = getPart(fig, "ece");
  const calibration = getPart(fig, "calibration");
  const comparison = getPart(fig, "comparison");
  const base = getPart(fig, "base");
  const statik = getPart(fig, "static");
  const ablationPart = getPart(fig, "ablation");
  const table1 = getPart(fig, "table1");
  const table3 = getPart(fig, "table3");
  const [x1, y1, w1, h1] = table1.box;
  const [x3, y3, w3, h3] = table3.box;
  const table1Rows = [
    ["BASE", table1FutureX.BASE],
    ["Static", table1FutureX["FoCo (Static)"],
    ],
    ["FoCo", table1FutureX.FoCo],
  ];
  const table3Rows = [
    ["BASE", table3FutureX.BASE],
    ["w/o F", table3FutureX["FoCo w/o factor"]],
    ["w/o R", table3FutureX["FoCo w/o reasoning"]],
    ["FoCo", table3FutureX.FoCo],
  ];
  const tableRows = (x, y, rows) => rows.map(([label, value], index) => {
    const rowY = y + index * 25;
    const b = value?.brier;
    const e = value?.ece;
    return [
      text(x, rowY, label, { size: 15, weight: 700 }),
      text(x + 105, rowY, `B ${fixed(b)}`, { size: 15, fill: PALETTE.ink }),
      text(x + 164, rowY, `E ${fixed(e)}`, { size: 15, fill: PALETTE.ink }),
    ].join("");
  }).join("");
  return [
    text(24, 34, "两个指标看不同问题，表格再把主结果和消融拆开", { size: 20, weight: 700 }),
    relationLine(probability.box[0] + probability.box[2], probability.box[1] + 41, brier.box[0], brier.box[1] + 48, "评价", { labelY: 74 }),
    relationLine(confidence.box[0] + confidence.box[2], confidence.box[1] + 41, ece.box[0], ece.box[1] + 55, "分箱", { labelY: 178 }),
    relationLine(brier.box[0] + brier.box[2], brier.box[1] + 48, comparison.box[0], comparison.box[1] + 30, "准确性口径", { labelY: 64 }),
    relationLine(ece.box[0] + ece.box[2], ece.box[1] + 55, comparison.box[0], comparison.box[1] + 52, "校准口径", { labelY: 152 }),
    relationLine(ece.box[0] + ece.box[2] / 2, ece.box[1] + ece.box[3], calibration.box[0] + calibration.box[2] / 2, calibration.box[1], "校准", { labelY: 294 }),
    relationLine(comparison.box[0] + comparison.box[2], comparison.box[1] + 30, table1.box[0], table1.box[1] + 66, "主结果", { labelY: 132 }),
    relationLine(comparison.box[0] + comparison.box[2], comparison.box[1] + 53, table3.box[0], table3.box[1] + 88, "组件对照", { labelY: 212 }),
    node(fig, probability, { fill: PALETTE.blue, titleSize: 17 }),
    node(fig, brier, { fill: PALETTE.green, titleSize: 17 }),
    node(fig, confidence, { fill: PALETTE.blue, titleSize: 17 }),
    node(fig, ece, { fill: PALETTE.lavender, titleSize: 17 }),
    node(fig, calibration, { fill: PALETTE.lavender, titleSize: 17 }),
    node(fig, comparison, { fill: PALETTE.gold, titleSize: 17 }),
    node(fig, base, { fill: PALETTE.paper, titleSize: 15, noteSize: 15 }),
    node(fig, statik, { fill: PALETTE.paper, titleSize: 15, noteSize: 15 }),
    node(fig, ablationPart, { fill: PALETTE.rose, titleSize: 16, noteSize: 15 }),
    interactive(fig, table1, `${panel(x1, y1, w1, h1, { fill: PALETTE.white })}${text(x1 + 12, y1 + 25, "Table 1 · 主结果", { size: 16, weight: 700 })}${text(x1 + 12, y1 + 50, "GPT-5-mini", { size: 15, fill: PALETTE.muted })}${text(x1 + 12, y1 + 71, "FutureX", { size: 15, fill: PALETTE.muted })}${text(x1 + 12, y1 + 96, "方法", { size: 15, weight: 700 })}${text(x1 + 117, y1 + 96, "Brier", { size: 15, weight: 700 })}${text(x1 + 176, y1 + 96, "ECE", { size: 15, weight: 700 })}${tableRows(x1 + 12, y1 + 121, table1Rows)}`),
    interactive(fig, table3, `${panel(x3, y3, w3, h3, { fill: PALETTE.white })}${text(x3 + 12, y3 + 25, "Table 3 · 消融", { size: 16, weight: 700 })}${text(x3 + 12, y3 + 50, "GPT-5-mini", { size: 15, fill: PALETTE.muted })}${text(x3 + 12, y3 + 71, "FutureX", { size: 15, fill: PALETTE.muted })}${text(x3 + 12, y3 + 96, "方法", { size: 15, weight: 700 })}${text(x3 + 117, y3 + 96, "Brier", { size: 15, weight: 700 })}${text(x3 + 176, y3 + 96, "ECE", { size: 15, weight: 700 })}${tableRows(x3 + 12, y3 + 121, table3Rows)}`),
  ].join("");
};

const renderReproduction = fig => {
  const config = getPart(fig, "config");
  const protocol = getPart(fig, "protocol");
  const comparison = getPart(fig, "comparison");
  const base = getPart(fig, "base");
  const statik = getPart(fig, "static");
  const ablationPart = getPart(fig, "ablation");
  const arm = (partValue, fill, memoryState, updateState) => {
    const [x, y, w, h] = partValue.box;
    const switchPill = (pillX, label, active) => [
      `<rect x="${pillX}" y="${y + 66}" width="${pillX === x + 12 ? 94 : 104}" height="28" rx="8" fill="${active ? PALETTE.green : PALETTE.rose}" stroke="${PALETTE.line}"/>`,
      text(pillX + (pillX === x + 12 ? 47 : 52), y + 85, label, { size: 15, weight: 600, anchor: "middle" }),
    ].join("");
    const body = [
      panel(x, y, w, h, { fill }),
      text(x + 14, y + 25, partValue.display, { size: partValue.id === "static" ? 15 : 17, weight: 700 }),
      text(x + 14, y + 51, partValue.note, { size: 15, fill: PALETTE.muted }),
      switchPill(x + 12, memoryState.label, memoryState.active),
      switchPill(x + 112, updateState.label, updateState.active),
    ].join("");
    return interactive(fig, partValue, body);
  };
  return [
    text(24, 34, "先固定能解释结果的条件，再分出独立比较实验臂", { size: 20, weight: 700 }),
    connector(config.box[0] + config.box[2], config.box[1] + 54, comparison.box[0], comparison.box[1] + 42, "固定条件", { labelY: 126 }),
    connector(protocol.box[0] + protocol.box[2], protocol.box[1] + 35, comparison.box[0], comparison.box[1] + 60, "固定时序", { labelY: 282 }),
    connector(comparison.box[0] + comparison.box[2], comparison.box[1] + 28, base.box[0], base.box[1] + 35, "实验臂", { labelY: 102 }),
    connector(comparison.box[0] + comparison.box[2], comparison.box[1] + 44, statik.box[0], statik.box[1] + 35, "实验臂", { labelY: 156 }),
    connector(comparison.box[0] + comparison.box[2], comparison.box[1] + 60, ablationPart.box[0], ablationPart.box[1] + 35, "实验臂", { labelY: 224 }),
    node(fig, config, { fill: PALETTE.blue, titleSize: 18 }),
    boundary(fig, protocol, { fill: PALETTE.paper }),
    node(fig, comparison, { fill: PALETTE.gold, titleSize: 17 }),
    arm(base, PALETTE.paper, { label: "F/R 关", active: false }, { label: "更新 关", active: false }),
    arm(statik, PALETTE.green, { label: "F/R 初始", active: true }, { label: "更新 关", active: false }),
    arm(ablationPart, PALETTE.rose, { label: "F 或 R 去掉", active: false }, { label: "更新 开", active: true }),
  ].join("");
};

const renderers = {
  probability: renderProbability,
  "signal-confidence": renderSignalConfidence,
  "memory-problem": renderMemoryProblem,
  "two-memories": renderTwoMemories,
  inference: renderInference,
  update: renderUpdate,
  evidence: renderEvidence,
  reproduction: renderReproduction,
};

const renderFigure = stepId => {
  const fig = figureByStepId.get(stepId) ?? figureById.get(stepId);
  if (!fig) throw new RangeError(`Unknown ForecastCompass figure step: ${stepId}`);
  const renderer = renderers[fig.renderer];
  if (!renderer) throw new Error(`No renderer for figure ${fig.id}`);
  const titleId = `${fig.id}-title`;
  const descId = `${fig.id}-description`;
  const markerId = `${fig.id}-arrow`;
  const rendered = renderer(fig).replaceAll("url(#figure-arrow)", `url(#${markerId})`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" id="${esc(fig.id)}-svg" class="knowledge-concept-figure-svg" viewBox="0 0 ${fig.width} ${fig.height}" role="group" aria-labelledby="${titleId} ${descId}" data-figure-step="${esc(fig.stepId)}"><title id="${titleId}">${esc(fig.title)}</title><desc id="${descId}">${esc(`${fig.diagramKind}。${fig.annotation}`)}</desc><defs><marker id="${esc(markerId)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${PALETTE.line}"/></marker></defs><rect x="0" y="0" width="${fig.width}" height="${fig.height}" rx="20" fill="${PALETTE.paper}"/>${rendered}</svg>`;
  return `<figure id="${esc(fig.id)}" class="concept-figure" data-figure-id="${esc(fig.id)}" data-step-id="${esc(fig.stepId)}" data-figure-kind="${esc(fig.diagramKind)}"><div class="figure-scroll">${svg}</div><div class="figure-reading" hidden aria-live="polite"></div><figcaption id="${esc(fig.id)}-caption"><strong>${esc(fig.title)}</strong><span>${esc(fig.caption)}</span><small>图解状态：讲解示意；来源：${esc(fig.source)}</small></figcaption></figure>`;
};

export { figures, figureById, figureByStepId, renderFigure };
