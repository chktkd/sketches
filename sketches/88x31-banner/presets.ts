import type { Doc, Layer, ShapeLayer, TextLayer } from './types';
import { clone, nid } from './util';

export const T = (o: Partial<TextLayer> = {}): TextLayer => ({
  type: 'text',
  visible: true,
  // 字形の中心を (x, y) に置く。フォントが端末ごとに違っても中央にそろう
  ax: 'center',
  ay: 'middle',
  x: 44,
  y: 15.5,
  text: 'TEXT',
  font: 'Silkscreen',
  size: 8,
  sx: 100,
  color: '#ffffff',
  fx: 'none',
  fxcol: '#000000',
  crisp: true,
  ...o,
  id: nid(),
});
export const R = (o: Partial<ShapeLayer> = {}): ShapeLayer => ({
  type: 'rect',
  visible: true,
  x: 0,
  y: 0,
  w: 20,
  h: 20,
  fillOn: true,
  fill: '#ffffff',
  strokeOn: false,
  stroke: '#000000',
  ...o,
  id: nid(),
});
export const E = (o: Partial<ShapeLayer> = {}): ShapeLayer => R({ ...o, type: 'ellipse' });

const D = (bg: Doc['bg'], border: Doc['border'], layers: Layer[]): Doc => ({
  bg,
  border,
  assets: {},
  link: true,
  frames: [{ delay: 500, layers }],
});

/*
 * 文字は中央基準で、置きたい領域の中心を指定する。
 * 左のアイコン枠（x 2〜27 前後）と右の文字領域（x 28〜86）の中心を基準にしている
 */
export const PRESETS: (() => Doc)[] = [
  () =>
    D({ type: 'vgrad', c1: '#3a6ea5', c2: '#0a2a55' }, { type: 'bevel', col: '#9fb7d6' }, [
      R({ x: 2, y: 2, w: 26, h: 27, fill: '#ffffff' }),
      T({ x: 15, y: 15.5, text: 'W3', font: 'Verdana', size: 11, color: '#0a2a55' }),
      T({ x: 57, y: 10, text: 'VALID', font: 'Verdana', size: 10, fx: 'shadow' }),
      T({ x: 57, y: 21, text: 'HTML 4.01', font: 'Verdana', size: 8, fx: 'shadow' }),
    ]),
  () => {
    const d = D({ type: 'scan', c1: '#000000', c2: '#0d2b14' }, { type: 'solid', col: '#00ff66' }, [
      T({ x: 44, y: 10, text: 'BEST VIEWED', size: 8, color: '#00ff66' }),
      T({ x: 44, y: 21, text: '800x600', size: 8, color: '#00ff66' }),
    ]);
    const f2 = clone(d.frames[0]);
    f2.layers[1].visible = false;
    d.frames.push(f2);
    return d;
  },
  () =>
    D({ type: 'stripe', c1: '#ffe3f1', c2: '#ffc4e1' }, { type: 'double', col: '#ff2d8a' }, [
      E({ x: 3, y: 4, w: 22, h: 23, fill: '#ff2d8a' }),
      T({ x: 14, y: 15.5, text: '♥', font: 'DotGothic16', size: 12 }),
      T({
        x: 56,
        y: 10,
        text: '相互リンク',
        font: 'DotGothic16',
        size: 11,
        color: '#ff2d8a',
        fx: 'outline',
        fxcol: '#ffffff',
      }),
      T({
        x: 56,
        y: 21.5,
        text: '募集中!',
        font: 'DotGothic16',
        size: 10,
        color: '#ff2d8a',
        fx: 'outline',
        fxcol: '#ffffff',
      }),
    ]),
  () =>
    D({ type: 'hgrad', c1: '#ff8a00', c2: '#c2185b' }, { type: 'inset', col: '#ffd29a' }, [
      R({ x: 2, y: 2, w: 22, h: 27, fill: '#1d232b' }),
      T({ x: 13, y: 15.5, text: 'DB', font: 'Pixelify Sans', size: 10, color: '#ffd29a' }),
      T({
        x: 55,
        y: 11,
        text: 'chiaki',
        font: 'Pixelify Sans',
        size: 13,
        color: '#fff4d6',
        fx: 'shadow',
        fxcol: '#3b1d00',
      }),
      T({ x: 55, y: 22, text: 'data engineer', font: 'Pixelify Sans', size: 7, color: '#fff4d6' }),
    ]),
];
