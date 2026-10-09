import "./CanvasViewMenu.css";

import type { CanvasModes } from "./CanvasWorkspace";

export interface CanvasViewMenuProps {
  modes: CanvasModes;
  onToggle: (mode: keyof CanvasModes) => void;
}

/**
 * A small application-level view menu. Excalidraw's native menu remains the
 * source of the editor controls; these buttons simply expose the same public
 * appState switches alongside the plugin's HTML content layer.
 */
export function CanvasViewMenu({ modes, onToggle }: CanvasViewMenuProps) {
  return (
    <div className="canvas-view-menu" role="toolbar" aria-label="画布视图">
      <span className="canvas-view-menu-label">视图</span>
      <button
        type="button"
        className={modes.gridModeEnabled ? "is-active" : ""}
        aria-pressed={modes.gridModeEnabled}
        onClick={() => onToggle("gridModeEnabled")}
      >
        网格对齐
      </button>
      <button
        type="button"
        className={modes.objectsSnapModeEnabled ? "is-active" : ""}
        aria-pressed={modes.objectsSnapModeEnabled}
        onClick={() => onToggle("objectsSnapModeEnabled")}
      >
        对象吸附
      </button>
      <button
        type="button"
        className={modes.zenModeEnabled ? "is-active" : ""}
        aria-pressed={modes.zenModeEnabled}
        onClick={() => onToggle("zenModeEnabled")}
      >
        {modes.zenModeEnabled ? "退出专注" : "专注模式"}
      </button>
    </div>
  );
}
