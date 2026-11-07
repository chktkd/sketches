import type { BBox, TextAnchorX, TextAnchorY, TextFx } from './types';

/** measureText の字形の実寸（textBaseline = alphabetic のとき） */
export interface InkMetrics {
  /** 描画原点から字形の左端までの距離（左にはみ出すと正） */
  left: number;
  /** 描画原点から字形の右端まで */
  right: number;
  /** ベースラインから字形の上端まで */
  ascent: number;
  /** ベースラインから字形の下端まで */
  descent: number;
}

export interface TextBoxInput {
  x: number;
  y: number;
  ax?: TextAnchorX;
  ay?: TextAnchorY;
  /** 横幅の拡縮（%） */
  sx: number;
  fx: TextFx;
}

export interface TextBox {
  /** fillText に渡す原点（alphabetic ベースライン） */
  originX: number;
  originY: number;
  /**
   * 字形そのものの範囲。左上は整数ピクセル、幅と高さは丸める前の実寸。
   * 基準点の逆算（anchorPoint）はこの値を使い、配置計算と同じ寸法で往復させる
   */
  ink: BBox;
  /** 効果（影・縁取り）込みの当たり判定。幅と高さは整数に切り上げる */
  bb: BBox;
}

const offset = (anchor: TextAnchorX | TextAnchorY, size: number) =>
  anchor === 'center' || anchor === 'middle'
    ? size / 2
    : anchor === 'right' || anchor === 'bottom'
      ? size
      : 0;

/**
 * 字形の実寸から、(x, y) を基準点として配置したときの描画原点と当たり判定を求める。
 * フォントの内部余白や端末ごとのフォント差に左右されず、基準点に対して字形がそろう。
 * 字形の左上は整数ピクセルに丸め、ドット絵の格子からずれないようにする。
 */
export function layoutText(L: TextBoxInput, m: InkMetrics): TextBox {
  const k = L.sx / 100;
  const w = (m.left + m.right) * k;
  const h = m.ascent + m.descent;
  const left = Math.round(L.x - offset(L.ax ?? 'left', w));
  const top = Math.round(L.y - offset(L.ay ?? 'top', h));
  const ink: BBox = { x: left, y: top, w, h };

  let bb: BBox = { x: left, y: top, w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
  if (L.fx === 'outline') bb = { x: bb.x - 1, y: bb.y - 1, w: bb.w + 2, h: bb.h + 2 };
  else if (L.fx === 'shadow') bb = { ...bb, w: bb.w + 1, h: bb.h + 1 };

  return { originX: left + m.left * k, originY: top + m.ascent, ink, bb };
}

/**
 * 基準点を変えても見た目の位置が変わらないように、新しい基準点の座標を返す。
 * ink は layoutText が返した字形の範囲（丸める前の実寸）を渡す
 */
export function anchorPoint(ink: BBox, ax: TextAnchorX, ay: TextAnchorY) {
  return { x: ink.x + offset(ax, ink.w), y: ink.y + offset(ay, ink.h) };
}

/**
 * 基準点を付け替えたあとの座標を、そのレイヤー自身の位置から求める。
 * 字形の寸法（size）は文字の設定だけで決まるので、連動フレームの同じレイヤーにも使える。
 * 移動量を一律に足すと、座標の小数部がフレームごとに違うときに丸めで 1px ずれるため、毎回ここから求め直す
 */
export function reanchor(
  pos: { x: number; y: number; ax?: TextAnchorX; ay?: TextAnchorY },
  size: { w: number; h: number },
  ax: TextAnchorX,
  ay: TextAnchorY
) {
  const ink: BBox = {
    x: Math.round(pos.x - offset(pos.ax ?? 'left', size.w)),
    y: Math.round(pos.y - offset(pos.ay ?? 'top', size.h)),
    w: size.w,
    h: size.h,
  };
  return anchorPoint(ink, ax, ay);
}
