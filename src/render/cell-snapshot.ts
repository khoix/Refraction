import type { Cell } from '@core/types';

/** Value snapshot: safe even when debug tools mutate a cell or reuse an array. */
export class CellSnapshot {
  private values = new Float64Array(0);
  private count = -1;

  matches(cells: readonly Cell[]): boolean {
    if (cells.length !== this.count) return false;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i] as Cell;
      if (this.values[i * 3] !== cell.x || this.values[i * 3 + 1] !== cell.y ||
        this.values[i * 3 + 2] !== cell.z) return false;
    }
    return true;
  }

  capture(cells: readonly Cell[]): void {
    if (this.values.length < cells.length * 3) this.values = new Float64Array(cells.length * 3);
    this.count = cells.length;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i] as Cell;
      this.values[i * 3] = cell.x;
      this.values[i * 3 + 1] = cell.y;
      this.values[i * 3 + 2] = cell.z;
    }
  }
}
