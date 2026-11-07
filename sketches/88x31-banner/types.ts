export const W = 88;
export const H = 31;

export type BgType = 'none' | 'solid' | 'hgrad' | 'vgrad' | 'stripe' | 'check' | 'scan';
export type BorderType = 'none' | 'solid' | 'bevel' | 'inset' | 'double';
export type TextFx = 'none' | 'shadow' | 'outline';
export type TextAnchorX = 'left' | 'center' | 'right';
export type TextAnchorY = 'top' | 'middle' | 'bottom';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayerBase {
  id: string;
  visible: boolean;
  x: number;
  y: number;
  /** 直近の描画で得た当たり判定。保存対象外 */
  _bb?: BBox;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  /** (x, y) が字形のどこを指すか。未指定は左上（古い保存データ） */
  ax?: TextAnchorX;
  ay?: TextAnchorY;
  text: string;
  font: string;
  size: number;
  /** 横幅の拡縮（%） */
  sx: number;
  color: string;
  fx: TextFx;
  fxcol: string;
  crisp: boolean;
}

export interface ShapeLayer extends LayerBase {
  type: 'rect' | 'ellipse';
  w: number;
  h: number;
  fillOn: boolean;
  fill: string;
  strokeOn: boolean;
  stroke: string;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  name: string;
  /** Doc.assets のキー */
  aid: string;
  /** 切り抜き後の縦横比（w/h） */
  ar: number;
  /** 元画像に対する割合（0〜1）。null は全体 */
  crop: Crop | null;
  w: number;
  h: number;
  lock: boolean;
  /** ドットの大きさ（px角） */
  blk: number;
  /** 1チャンネルの階調数。2未満は減色なし */
  levels: number;
  dither: boolean;
  alphaCut: boolean;
  flip: boolean;
  opacity: number;
}

export type Layer = TextLayer | ShapeLayer | ImageLayer;

export interface Frame {
  delay: number;
  layers: Layer[];
}
export interface Asset {
  src: string;
  w: number;
  h: number;
}

export interface Doc {
  bg: { type: BgType; c1: string; c2: string };
  border: { type: BorderType; col: string };
  assets: Record<string, Asset>;
  /** 全フレーム連動 */
  link: boolean;
  frames: Frame[];
}
