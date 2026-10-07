import type { ProjectSnapshot, TargetRef } from "../contracts";
import type { ContentCommit } from "../content/model";
import { planContentTransform } from "./content-geometry";

/** Numeric controls complement the direct drag/resize handles, including
 * images which deliberately have no HTML card covering their native surface. */
export function TransformControls({ snapshot, target, commit, geometryOverride }: { snapshot: ProjectSnapshot; target: TargetRef; commit: ContentCommit; geometryOverride?: { x: number; y: number; width: number; height: number } }) {
  const rep = target.type === "representation" ? snapshot.representations.find(item => item.id === target.representationId) : undefined;
  const free = target.type === "element" ? snapshot.freeElements.find(item => item.id === target.elementId) : undefined;
  if (!rep && !free) return null;
  const geometry = { ...(rep ?? free!.element), ...geometryOverride };
  const data = free?.element.customData as Record<string, unknown> | undefined;
  const notebook = data?.notebook as Record<string, unknown> | undefined;
  const pinned = rep ? rep.pinned : notebook?.pinned === true || free?.element.locked === true;
  const apply = (patch: Parameters<typeof planContentTransform>[2]) => {
    let operations = planContentTransform(snapshot, target, patch, geometryOverride);
    if (patch.pinned === false && free?.element.locked === true) operations = operations.map(operation => operation.type === "free.put" ? { ...operation, freeElement: { ...operation.freeElement, element: { ...operation.freeElement.element, locked: false } } } : operation);
    if (!operations.length && patch.pinned === false && free?.element.locked === true) operations = [{ type: "free.put", freeElement: { ...free, element: { ...free.element, locked: false } } }];
    if (operations.length) void commit(operations, patch.pinned === false ? "用户允许自动整理此处" : "用户自由调整当前内容块", snapshot.revision);
  };
  return <section className="transform-controls" aria-label="所选内容的自由变形">
    <div className="content-section-title"><strong>位置与形状</strong><button className="text-button" onClick={() => apply({ pinned: !pinned })}>{pinned ? "允许自动整理" : "固定位置"}</button></div>
    <div className="transform-fields">{(["x", "y", "width", "height", "rotation"] as const).map(field => {
      const raw = field === "rotation" ? Number(rep?.rotation ?? free?.element.angle ?? 0) * 180 / Math.PI : Number(geometry[field]);
      const value = Math.round(raw * 10) / 10;
      const label = { x: "横向位置", y: "纵向位置", width: "宽度", height: "高度", rotation: "旋转角度" }[field];
      return <label key={field}>{label}<input type="number" aria-label={`所选内容${label}`} key={`${target.type}:${value}`} defaultValue={value} step={field === "rotation" ? 5 : 10} min={field === "width" ? 120 : field === "height" ? 80 : undefined} onBlur={event => { const next = Number(event.target.value); if (Number.isFinite(next) && next !== raw) apply({ [field]: field === "rotation" ? next * Math.PI / 180 : next }); }} /></label>;
    })}</div>
    <p>拖动手柄移动，拉伸角点调整大小；文字随宽度重排。</p>
  </section>;
}
