// Semantic viewpoints are independent of teaching order and edge direction.
// Lanes organise a local map; they never invent or suppress canonical edges.
export const topologies = {
  overview: { focusId: "memory", left: ["foco", "retrospective", "revision"], right: ["agent", "trajectory", "comparison"], leftLabel: "方法与更新", rightLabel: "预测与评价", centerLabel: "共享记忆 · 闭环中心" },
  "map-probability": { focusId: "forecast-question", left: ["protocol"], right: ["agent", "probability"], leftLabel: "时间约束", rightLabel: "求解与答案", centerLabel: "当前问题" },
  "map-signal-confidence": { focusId: "calibration", left: ["probability", "confidence"], right: ["protocol", "signal"], leftLabel: "判断有多确定", rightLabel: "证据从哪里来", centerLabel: "把信心与实际对照" },
  "map-memory-problem": { focusId: "lesson", left: ["signal", "calibration"], right: ["protocol", "foco"], leftLabel: "经验的两个方面", rightLabel: "适用边界与方法", centerLabel: "从个例提炼原则" },
  "map-two-memories": { focusId: "memory", left: ["foco", "taxonomy", "subcategory"], right: ["factor", "reasoning"], leftLabel: "按哪类问题找", rightLabel: "找到后分工", centerLabel: "一个子类别 · 两份手册" },
  "map-inference": { focusId: "trajectory", left: ["memory", "factor", "reasoning"], right: ["forecast-question", "protocol", "probability"], leftLabel: "可用经验与分工", rightLabel: "问题、边界与答案", centerLabel: "这一次如何形成判断" },
  "map-update": { focusId: "diagnosis", left: ["outcome", "trajectory", "retrospective"], right: ["aggregation", "revision", "memory"], leftLabel: "前后记录与对照", rightLabel: "提炼后服务未来", centerLabel: "定位两类差异" },
  "map-evidence": { focusId: "comparison", left: ["probability", "brier", "table1-result"], right: ["confidence", "ece", "table3-ablation"], leftLabel: "概率与总体表现", rightLabel: "信心与组件证据", centerLabel: "同条件比较 · 双视角" },
  "map-reproduction": { focusId: "comparison", left: ["config", "protocol"], right: ["base", "static", "ablation"], leftLabel: "先固定共同条件", rightLabel: "独立对照分支", centerLabel: "哪些比较可解释" },
};

export function validateTopology(map, topology) {
  const ids = [topology.focusId, ...topology.left, ...topology.right];
  return ids.length === map.nodeIds.length && new Set(ids).size === ids.length && map.nodeIds.every(id => ids.includes(id));
}
