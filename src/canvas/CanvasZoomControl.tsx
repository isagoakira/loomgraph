import { sliderZoom, zoomSliderValue, ZOOM_MAX, ZOOM_MIN } from "./camera";

export function CanvasZoomControl({ zoom, onZoom, onFit, disabled = false }: { zoom: number; onZoom: (zoom: number) => void; onFit: () => void; disabled?: boolean }) {
  return <div className="canvas-zoom-control" role="group" aria-label="整图缩放" onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <button type="button" aria-label="缩小整图" title="缩小整图" disabled={disabled || zoom <= ZOOM_MIN} onClick={() => onZoom(zoom / 1.25)}>−</button>
    <input type="range" aria-label="整图缩放滑块" aria-valuetext={`${Math.round(zoom * 100)}%`} min="0" max="100" step="0.1" value={zoomSliderValue(zoom)} disabled={disabled} onChange={event => onZoom(sliderZoom(Number(event.currentTarget.value)))} />
    <button type="button" aria-label="放大整图" title="放大整图" disabled={disabled || zoom >= ZOOM_MAX} onClick={() => onZoom(zoom * 1.25)}>＋</button>
    <button type="button" className="zoom-percent" aria-label="恢复整图100%缩放" title="恢复100%" disabled={disabled} onClick={() => onZoom(1)}>{Math.round(zoom * 100)}%</button>
    <button type="button" aria-label="缩放至整图" title="适应整图" disabled={disabled} onClick={onFit}>⛶</button>
  </div>;
}
