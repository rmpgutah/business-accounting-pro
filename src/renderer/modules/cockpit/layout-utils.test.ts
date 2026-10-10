import { describe, it, expect } from 'vitest';
import * as u from './layout-utils';

describe('cockpit-layout', () => {
  it('clampPlacement keeps widgets in bounds', () => {
    expect(u.clampPlacement({ id: 'a', type: 't', x: 11, y: -2, w: 6, h: 0 })).toEqual({ id: 'a', type: 't', x: 6, y: 0, w: 6, h: 1 });
  });
  it('clampPlacement caps width to grid', () => {
    expect(u.clampPlacement({ id: 'a', type: 't', x: 0, y: 0, w: 99, h: 2 }).w).toBe(u.GRID_COLS);
  });
  it('nextFreeRow returns 0 for empty layout', () => {
    expect(u.nextFreeRow([])).toBe(0);
  });
  it('nextFreeRow returns below lowest widget', () => {
    expect(u.nextFreeRow([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }, { id: 'b', type: 't', x: 4, y: 3, w: 4, h: 1 }])).toBe(4);
  });
  it('addWidget places new widget at the bottom full-defaults', () => {
    const out = u.addWidget([{ id: 'a', type: 't', x: 0, y: 0, w: 12, h: 2 }], 'kpi', 'b');
    expect(out.length).toBe(2);
    expect(out[1].y).toBe(2);
  });
  it('removeWidget drops by id', () => {
    expect(u.removeWidget([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }], 'a').length).toBe(0);
  });
  it('updatePlacement patches + re-clamps', () => {
    const out = u.updatePlacement([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }], 'a', { x: 99 });
    expect(out[0].x).toBe(u.GRID_COLS - 4);
  });
  it('pixelToCell maps offset to grid', () => {
    // canvas 1200px / 12 cols = 100px per col; 250px → col 3 (rounded: 2.5 → 3 via round-half-up)
    expect(u.pixelToCell(250, 0, 1200, 80).x).toBe(3);
  });
});
