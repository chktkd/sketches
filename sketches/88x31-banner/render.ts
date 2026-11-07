import { layoutText } from './layout';
import { H, W, type Doc, type ImageLayer, type ShapeLayer, type TextLayer } from './types';

const ctx2d = (cv: HTMLCanvasElement) => cv.getContext('2d', { willReadFrequently: true })!;
const canvas = (w = W, h = H) =>
  Object.assign(document.createElement('canvas'), { width: w, height: h });

let onImageLoad: () => void = () => {};
export const setImageLoadHandler = (fn: () => void) => {
  onImageLoad = fn;
};

const imgEls = new Map<string, { img: HTMLImageElement; ready: boolean }>();
const pcache = new Map<string, HTMLCanvasElement>();
export function clearCaches() {
  imgEls.clear();
  pcache.clear();
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function fillBg(c: CanvasRenderingContext2D, bg: Doc['bg']) {
  if (bg.type === 'none') return;
  if (bg.type === 'hgrad' || bg.type === 'vgrad') {
    const g =
      bg.type === 'hgrad' ? c.createLinearGradient(0, 0, W, 0) : c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, bg.c1);
    g.addColorStop(1, bg.c2);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    return;
  }
  c.fillStyle = bg.c1;
  c.fillRect(0, 0, W, H);
  if (bg.type === 'solid') return;
  c.fillStyle = bg.c2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const on =
        bg.type === 'stripe'
          ? (x + y) % 6 < 3
          : bg.type === 'check'
            ? (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0
            : y % 2 === 1;
      if (on) c.fillRect(x, y, 1, 1);
    }
}

function drawBorder(c: CanvasRenderingContext2D, b: Doc['border']) {
  const { type: t, col } = b;
  if (t === 'none') return;
  const rect = (x: number, y: number, w: number, h: number, k: string) => {
    c.fillStyle = k;
    c.fillRect(x, y, w, h);
  };
  if (t === 'solid' || t === 'double') {
    rect(0, 0, W, 1, col);
    rect(0, H - 1, W, 1, col);
    rect(0, 0, 1, H, col);
    rect(W - 1, 0, 1, H, col);
    if (t === 'double') {
      rect(2, 2, W - 4, 1, col);
      rect(2, H - 3, W - 4, 1, col);
      rect(2, 2, 1, H - 4, col);
      rect(W - 3, 2, 1, H - 4, col);
    }
    return;
  }
  const up = t === 'bevel';
  const a = shade(col, up ? 0.55 : -0.55),
    z = shade(col, up ? -0.55 : 0.55);
  const a2 = shade(col, up ? 0.25 : -0.3),
    z2 = shade(col, up ? -0.3 : 0.25);
  rect(0, 0, W, 1, a);
  rect(0, 0, 1, H, a);
  rect(0, H - 1, W, 1, z);
  rect(W - 1, 0, 1, H, z);
  rect(1, 1, W - 2, 1, a2);
  rect(1, 1, 1, H - 2, a2);
  rect(1, H - 2, W - 2, 1, z2);
  rect(W - 2, 1, 1, H - 2, z2);
}

function threshold(c: CanvasRenderingContext2D) {
  const d = c.getImageData(0, 0, W, H),
    p = d.data;
  for (let i = 3; i < p.length; i += 4) p[i] = p[i] >= 110 ? 255 : 0;
  c.putImageData(d, 0, 0);
}

function drawText(c: CanvasRenderingContext2D, L: TextLayer) {
  const t = canvas(),
    x = ctx2d(t);
  const font = `${L.size}px "${L.font}"`;
  x.font = font;
  x.textBaseline = 'alphabetic';
  const tm = x.measureText(L.text);
  // 字形の実寸で配置する。フォントの内部余白や端末ごとのフォント差で位置がずれないようにする
  const box = layoutText(L, {
    left: tm.actualBoundingBoxLeft,
    right: tm.actualBoundingBoxRight,
    ascent: tm.actualBoundingBoxAscent,
    descent: tm.actualBoundingBoxDescent,
  });
  const put = (dx: number, dy: number, col: string) => {
    x.save();
    x.fillStyle = col;
    x.font = font;
    x.textBaseline = 'alphabetic';
    x.translate(box.originX + dx, box.originY + dy);
    x.scale(L.sx / 100, 1);
    x.fillText(L.text, 0, 0);
    x.restore();
  };
  if (L.fx === 'shadow') put(1, 1, L.fxcol);
  if (L.fx === 'outline')
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ])
      put(dx, dy, L.fxcol);
  put(0, 0, L.color);
  if (L.crisp) threshold(x);
  c.drawImage(t, 0, 0);
  L._bb = box.bb;
}

function drawRect(c: CanvasRenderingContext2D, L: ShapeLayer) {
  if (L.fillOn) {
    c.fillStyle = L.fill;
    c.fillRect(L.x, L.y, L.w, L.h);
  }
  if (L.strokeOn) {
    c.fillStyle = L.stroke;
    c.fillRect(L.x, L.y, L.w, 1);
    c.fillRect(L.x, L.y + L.h - 1, L.w, 1);
    c.fillRect(L.x, L.y, 1, L.h);
    c.fillRect(L.x + L.w - 1, L.y, 1, L.h);
  }
  L._bb = { x: L.x, y: L.y, w: L.w, h: L.h };
}

function drawEllipse(c: CanvasRenderingContext2D, L: ShapeLayer) {
  const rx = L.w / 2,
    ry = L.h / 2,
    cx = L.x + rx,
    cy = L.y + ry;
  const inside = (px: number, py: number) => {
    const dx = (px + 0.5 - cx) / rx,
      dy = (py + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
  for (let py = L.y; py < L.y + L.h; py++)
    for (let px = L.x; px < L.x + L.w; px++) {
      if (!inside(px, py)) continue;
      const edge =
        !inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1);
      if (L.strokeOn && edge) {
        c.fillStyle = L.stroke;
        c.fillRect(px, py, 1, 1);
      } else if (L.fillOn) {
        c.fillStyle = L.fill;
        c.fillRect(px, py, 1, 1);
      }
    }
  L._bb = { x: L.x, y: L.y, w: L.w, h: L.h };
}

function imgEl(d: Doc, aid: string) {
  let e = imgEls.get(aid);
  if (e) return e;
  const a = d.assets[aid];
  if (!a) return null;
  const img = new Image();
  const entry = { img, ready: false };
  img.onload = () => {
    entry.ready = true;
    onImageLoad();
  };
  img.src = a.src;
  imgEls.set(aid, entry);
  return entry;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** トリミング → 段階的に縮小 → ドット化 → 減色（＋ディザ） */
function pixelize(img: HTMLImageElement, L: ImageLayer): HTMLCanvasElement {
  const cr = L.crop ?? { x: 0, y: 0, w: 1, h: 1 },
    nw = img.naturalWidth,
    nh = img.naturalHeight;
  const sw0 = Math.max(1, Math.round(cr.w * nw)),
    sh0 = Math.max(1, Math.round(cr.h * nh));
  let src = canvas(sw0, sh0);
  ctx2d(src).drawImage(img, Math.round(cr.x * nw), Math.round(cr.y * nh), sw0, sh0, 0, 0, sw0, sh0);

  const blk = L.blk || 1,
    tw = Math.max(1, Math.round(L.w / blk)),
    th = Math.max(1, Math.round(L.h / blk));
  let sw = sw0,
    sh = sh0;
  while (sw / 2 >= tw * 2 && sh / 2 >= th * 2) {
    const c = canvas(Math.ceil(sw / 2), Math.ceil(sh / 2)),
      x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const sm = canvas(tw, th),
    o = ctx2d(sm);
  o.imageSmoothingQuality = 'high';
  if (L.flip) {
    o.translate(tw, 0);
    o.scale(-1, 1);
  }
  o.drawImage(src, 0, 0, tw, th);

  const d = o.getImageData(0, 0, tw, th),
    p = d.data,
    n = L.levels;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 4;
      if (n >= 2) {
        const st = 255 / (n - 1),
          off = L.dither ? (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * st : 0;
        for (let k = 0; k < 3; k++)
          p[i + k] = Math.max(0, Math.min(255, Math.round((p[i + k] + off) / st) * st));
      }
      if (L.alphaCut) p[i + 3] = p[i + 3] >= 128 ? 255 : 0;
    }
  o.putImageData(d, 0, 0);

  const out = canvas(L.w, L.h),
    q = ctx2d(out);
  q.imageSmoothingEnabled = false;
  q.drawImage(sm, 0, 0, L.w, L.h);
  return out;
}

function drawImage(c: CanvasRenderingContext2D, L: ImageLayer, d: Doc) {
  L._bb = { x: L.x, y: L.y, w: L.w, h: L.h };
  const e = imgEl(d, L.aid);
  if (!e || !e.ready) return;
  const key = [
    L.aid,
    L.w,
    L.h,
    L.blk,
    L.levels,
    L.dither,
    L.alphaCut,
    L.flip,
    JSON.stringify(L.crop ?? 0),
  ].join('|');
  let cv = pcache.get(key);
  if (!cv) {
    cv = pixelize(e.img, L);
    if (pcache.size > 300) pcache.clear();
    pcache.set(key, cv);
  }
  c.globalAlpha = (L.opacity ?? 100) / 100;
  c.drawImage(cv, L.x, L.y);
  c.globalAlpha = 1;
}

export function render(d: Doc, frame: number, cv: HTMLCanvasElement) {
  const c = ctx2d(cv);
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, W, H);
  fillBg(c, d.bg);
  for (const L of d.frames[frame].layers) {
    if (!L.visible) continue;
    switch (L.type) {
      case 'text':
        drawText(c, L);
        break;
      case 'rect':
        drawRect(c, L);
        break;
      case 'ellipse':
        drawEllipse(c, L);
        break;
      case 'image':
        drawImage(c, L, d);
        break;
    }
  }
  drawBorder(c, d.border);
}

export const newCanvas = canvas;
export const getCtx = ctx2d;
