/** 世界の単位はメートル。街は 1 セル 1.5m のボクセルで構成する */
export const CELL = 1.5;
/** 1 階 = 3m = 2 セル層 */
export const LAYERS_PER_FLOOR = 2;
export const BLOCKS = 5;
export const BLOCK_CELLS = 28;
export const ROAD_CELLS = 12;
export const PITCH = BLOCK_CELLS + ROAD_CELLS;
export const GRID_N = BLOCKS * PITCH + ROAD_CELLS;
export const GRID_Y = 32;
export const WORLD_SIZE = GRID_N * CELL;
export const HALF = WORLD_SIZE / 2;

export const cellX = (ix: number) => (ix + 0.5) * CELL - HALF;
export const cellY = (iy: number) => (iy + 0.5) * CELL;
export const cellZ = (iz: number) => (iz + 0.5) * CELL - HALF;
export const toCellX = (x: number) => Math.floor((x + HALF) / CELL);
export const toCellY = (y: number) => Math.floor(y / CELL);
export const toCellZ = (z: number) => Math.floor((z + HALF) / CELL);
