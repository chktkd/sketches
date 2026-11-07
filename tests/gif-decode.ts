/**
 * テスト専用の最小 GIF デコーダ。encodeGIF の出力を RGBA に戻して検証する。
 * ローカルカラーテーブル・GCE（透過・表示時間）・LZW に対応し、インターレースは扱わない。
 */
export interface DecodedFrame {
  rgba: Uint8ClampedArray;
  delay: number;
}
export interface DecodedGif {
  width: number;
  height: number;
  loop: boolean;
  frames: DecodedFrame[];
}

function lzwDecode(data: number[], minSize: number, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  const clear = 1 << minSize;
  const eoi = clear + 1;
  let size = minSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minSize + 1;
  };
  reset();
  let pos = 0;
  let bit = 0;
  let prev: number[] | null = null;
  const read = () => {
    let code = 0;
    for (let i = 0; i < size; i++) {
      const byte = data[(bit + i) >> 3] ?? 0;
      code |= ((byte >> ((bit + i) & 7)) & 1) << i;
    }
    bit += size;
    return code;
  };
  while (pos < pixels) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error(`invalid code ${code}`);
    for (const v of entry) out[pos++] = v;
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return out;
}

export function decodeGIF(bytes: Uint8Array): DecodedGif {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => {
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };
  const sig = String.fromCharCode(...bytes.slice(0, 6));
  if (sig !== 'GIF89a') throw new Error(`bad signature ${sig}`);
  p = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));

  const frames: DecodedFrame[] = [];
  let loop = false;
  let delay = 0;
  let trans = -1;
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const flags = u8();
        delay = u16() * 10;
        const t = u8();
        trans = flags & 1 ? t : -1;
        u8();
      } else {
        const blocks: number[] = [];
        for (let n = u8(); n; n = u8()) {
          for (let i = 0; i < n; i++) blocks.push(u8());
        }
        if (label === 0xff && String.fromCharCode(...blocks.slice(0, 11)) === 'NETSCAPE2.0') {
          loop = true;
        }
      }
      continue;
    }
    if (b !== 0x2c) throw new Error(`unexpected block 0x${b.toString(16)}`);
    p += 4;
    const w = u16();
    const h = u16();
    const fl = u8();
    let pal: number[] = [];
    if (fl & 0x80) {
      const n = 1 << ((fl & 7) + 1);
      pal = Array.from(bytes.slice(p, p + n * 3));
      p += n * 3;
    }
    const minSize = u8();
    const data: number[] = [];
    for (let n = u8(); n; n = u8()) {
      for (let i = 0; i < n; i++) data.push(u8());
    }
    const idx = lzwDecode(data, minSize, w * h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    idx.forEach((k, i) => {
      if (k === trans) return;
      rgba.set([pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2], 255], i * 4);
    });
    frames.push({ rgba, delay });
  }
  return { width, height, loop, frames };
}
