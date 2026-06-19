export const GRID_COLS = 12;
export interface WidgetPlacement { id: string; type: string; x: number; y: number; w: number; h: number; }

/** Clamp a placement to the grid: x in [0, COLS-w], w in [1, COLS], y,h >= 0/1. */
export function clampPlacement(p: WidgetPlacement, cols = GRID_COLS): WidgetPlacement {
  const w = Math.max(1, Math.min(p.w, cols));
  const x = Math.max(0, Math.min(p.x, cols - w));
  const h = Math.max(1, p.h);
  const y = Math.max(0, p.y);
  return { ...p, x, w, y, h };
}

/** Pixel offset → grid cell, given the canvas content width and current cols. */
export function pixelToCell(px: number, py: number, canvasW: number, rowH: number, cols = GRID_COLS): { x: number; y: number } {
  const cellW = canvasW / cols;
  return { x: Math.max(0, Math.round(px / cellW)), y: Math.max(0, Math.round(py / rowH)) };
}

/** First free row at full width for a new widget: place below the lowest occupied cell. */
export function nextFreeRow(layout: WidgetPlacement[]): number {
  return layout.reduce((max, p) => Math.max(max, p.y + p.h), 0);
}

/** Add a widget of `type` (default size) at the bottom; returns a new layout. */
export function addWidget(layout: WidgetPlacement[], type: string, id: string, w = 4, h = 2): WidgetPlacement[] {
  return [...layout, clampPlacement({ id, type, x: 0, y: nextFreeRow(layout), w, h })];
}

export function removeWidget(layout: WidgetPlacement[], id: string): WidgetPlacement[] {
  return layout.filter(p => p.id !== id);
}

export function updatePlacement(layout: WidgetPlacement[], id: string, patch: Partial<WidgetPlacement>): WidgetPlacement[] {
  return layout.map(p => (p.id === id ? clampPlacement({ ...p, ...patch }) : p));
}
