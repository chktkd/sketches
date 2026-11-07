/**
 * 最小限の GIF89a エンコーダ（外部ライブラリなし）
 * - フレームごとにローカルパレット（256 色を超えたら median cut で減色）
 * - アルファ < 128 は透過色（index 0）
 * - 無限ループ、disposal = 2（背景に戻す）
 */
export interface GifFrame {
  data: Uint8ClampedArray;
  delay: number;
}

interface Quantized {
  idx: Uint8Array;
  colors: number[];
  trans: boolean;
}

type Rgb = [number, number, number];
interface ColorCount {
  rgb: Rgb;
  c: number;
}

/**
 * Median cut：色の分布が最も広いチャンネルで箱を画素数の中央で 2 分割することを繰り返し、
 * 各箱の加重平均をパレットにする。出現頻度の低い色も、近い代表色に割り当てられる
 */
function medianCut(counts: Map<number, number>, max: number): number[] {
  const all: ColorCount[] = [...counts].map(([k, c]) => ({
    rgb: [(k >> 16) & 255, (k >> 8) & 255, k & 255],
    c,
  }));
  const range = (box: ColorCount[]) => {
    const lo: Rgb = [255, 255, 255];
    const hi: Rgb = [0, 0, 0];
    for (const { rgb } of box) {
      for (let ch = 0; ch < 3; ch++) {
        lo[ch] = Math.min(lo[ch], rgb[ch]);
        hi[ch] = Math.max(hi[ch], rgb[ch]);
      }
    }
    const spans = hi.map((h, ch) => h - lo[ch]);
    const ch = spans.indexOf(Math.max(...spans));
    return { ch, span: spans[ch] };
  };
  const boxes: ColorCount[][] = [all];
  while (boxes.length < max) {
    let target = -1;
    let widest = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const { span } = range(b);
      if (span > widest) {
        widest = span;
        target = i;
      }
    });
    if (target < 0) break;
    const box = boxes[target];
    const { ch } = range(box);
    box.sort((a, b) => a.rgb[ch] - b.rgb[ch]);
    const total = box.reduce((s, e) => s + e.c, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].c;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(target, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (const { rgb, c } of box) {
      for (let ch = 0; ch < 3; ch++) sum[ch] += rgb[ch] * c;
      n += c;
    }
    const [r, g, b] = sum.map((s) => Math.round(s / n));
    return (r << 16) | (g << 8) | b;
  });
}

function quantize(p: Uint8ClampedArray, n: number): Quantized {
  const idx = new Uint8Array(n);
  const counts = new Map<number, number>();
  let trans = false;
  for (let i = 0; i < n; i++) {
    if (p[i * 4 + 3] < 128) {
      trans = true;
      continue;
    }
    const k = (p[i * 4] << 16) | (p[i * 4 + 1] << 8) | p[i * 4 + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const max = trans ? 255 : 256;
  const pal = counts.size <= max ? [...counts.keys()] : medianCut(counts, max);
  const off = trans ? 1 : 0;
  const memo = new Map<number, number>();
  pal.forEach((k, i) => memo.set(k, i + off));
  const near = (k: number): number => {
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const r = (k >> 16) & 255,
      g = (k >> 8) & 255,
      b = k & 255;
    let best = 0,
      bd = Infinity;
    pal.forEach((q, i) => {
      const d = (r - ((q >> 16) & 255)) ** 2 + (g - ((q >> 8) & 255)) ** 2 + (b - (q & 255)) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    memo.set(k, best + off);
    return best + off;
  };
  for (let i = 0; i < n; i++) {
    idx[i] = p[i * 4 + 3] < 128 ? 0 : near((p[i * 4] << 16) | (p[i * 4 + 1] << 8) | p[i * 4 + 2]);
  }
  return { idx, colors: (trans ? [0] : []).concat(pal), trans };
}

function lzw(ix: Uint8Array, minSize: number): number[] {
  const clear = 1 << minSize,
    eoi = clear + 1,
    out: number[] = [];
  let cs = minSize + 1,
    next = eoi + 1,
    dict = new Map<number, number>(),
    acc = 0,
    nb = 0;
  const emit = (c: number) => {
    acc |= c << nb;
    nb += cs;
    while (nb >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      nb -= 8;
    }
  };
  emit(clear);
  let pre = ix[0];
  for (let i = 1; i < ix.length; i++) {
    const k = ix[i],
      key = (pre << 8) | k,
      hit = dict.get(key);
    if (hit !== undefined) {
      pre = hit;
      continue;
    }
    emit(pre);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << cs && cs < 12) cs++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      cs = minSize + 1;
    }
    pre = k;
  }
  emit(pre);
  emit(eoi);
  if (nb > 0) out.push(acc & 255);
  return out;
}

export function encodeGIF(
  frames: GifFrame[],
  width: number,
  height: number
): Uint8Array<ArrayBuffer> {
  const o: number[] = [];
  const b = (...a: number[]) => {
    for (const v of a) o.push(v);
  };
  const w16 = (v: number) => b(v & 255, (v >> 8) & 255);
  const str = (s: string) => {
    for (const c of s) o.push(c.charCodeAt(0));
  };

  str('GIF89a');
  w16(width);
  w16(height);
  b(0, 0, 0);
  b(0x21, 0xff, 0x0b);
  str('NETSCAPE2.0');
  b(3, 1, 0, 0, 0);

  for (const f of frames) {
    const q = quantize(f.data, width * height);
    const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, q.colors.length))));
    const size = 1 << bits;
    b(0x21, 0xf9, 4, (2 << 2) | (q.trans ? 1 : 0));
    w16(Math.max(2, Math.round(f.delay / 10)));
    b(0, 0);
    b(0x2c);
    w16(0);
    w16(0);
    w16(width);
    w16(height);
    b(0x80 | (bits - 1));
    for (let i = 0; i < size; i++) {
      const c = q.colors[i] ?? 0;
      b((c >> 16) & 255, (c >> 8) & 255, c & 255);
    }
    const ms = Math.max(2, bits);
    b(ms);
    const d = lzw(q.idx, ms);
    for (let i = 0; i < d.length; i += 255) {
      const ch = d.slice(i, i + 255);
      o.push(ch.length);
      for (const v of ch) o.push(v);
    }
    b(0);
  }
  b(0x3b);
  return new Uint8Array(o);
}
