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
  /** 効果（影・縁取り）込みの当たり判定 */
  bb: BBox;
}

/**
 * 字形の実寸から、(x, y) を基準点として配置したときの描画原点と当たり判定を求める。
 * フォントの内部余白や端末ごとのフォント差に左右されず、基準点に対して字形がそろう。
 * 字形の左上は整数ピクセルに丸め、ドット絵の格子からずれないようにする。
 */
export function layoutText(L: TextBoxInput, m: InkMetrics): TextBox {
  const k = L.sx / 100;
  const w = (m.left + m.right) * k;
  const h = m.ascent + m.descent;
  const ax = L.ax ?? 'left';
  const ay = L.ay ?? 'top';
  const left = Math.round(L.x - (ax === 'center' ? w / 2 : ax === 'right' ? w : 0));
  const top = Math.round(L.y - (ay === 'middle' ? h / 2 : ay === 'bottom' ? h : 0));

  let bb: BBox = { x: left, y: top, w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(h)) };
  if (L.fx === 'outline') bb = { x: bb.x - 1, y: bb.y - 1, w: bb.w + 2, h: bb.h + 2 };
  else if (L.fx === 'shadow') bb = { ...bb, w: bb.w + 1, h: bb.h + 1 };

  return { originX: left + m.left * k, originY: top + m.ascent, bb };
}

/** 基準点を変えても見た目の位置が変わらないように、新しい基準点の座標を返す */
export function anchorPoint(bb: BBox, ax: TextAnchorX, ay: TextAnchorY, fx: TextFx) {
  // 当たり判定は効果の分だけ広がっているので、字形そのものの範囲に戻してから求める
  const ink =
    fx === 'outline'
      ? { x: bb.x + 1, y: bb.y + 1, w: bb.w - 2, h: bb.h - 2 }
      : fx === 'shadow'
        ? { ...bb, w: bb.w - 1, h: bb.h - 1 }
        : bb;
  return {
    x: ink.x + (ax === 'center' ? ink.w / 2 : ax === 'right' ? ink.w : 0),
    y: ink.y + (ay === 'middle' ? ink.h / 2 : ay === 'bottom' ? ink.h : 0),
  };
}
