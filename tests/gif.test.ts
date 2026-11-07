import { describe, expect, it } from 'vitest';
import { encodeGIF } from '../sketches/88x31-banner/gif';
import { decodeGIF } from './gif-decode';

const W = 88;
const H = 31;

/** 色数が 256 以内に収まる、透過を含むフレーム */
function smallPalette(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = (i * 37) % 250;
    d.set([v, 255 - v, 40, i % 11 === 0 ? 0 : 255], i * 4);
  }
  return d;
}

/** 256 色を大きく超えるグラデーション */
function manyColors(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = Math.floor(i / W);
    d.set([x * 2.9, y * 8, (x * y) % 256, 255], i * 4);
  }
  return d;
}

describe('encodeGIF', () => {
  it('256 色以内のフレームはピクセル単位で元に戻る（透過を含む）', () => {
    const src = smallPalette();
    const gif = decodeGIF(encodeGIF([{ data: src, delay: 120 }], W, H));
    const out = gif.frames[0].rgba;
    for (let i = 0; i < W * H; i++) {
      if (src[i * 4 + 3] === 0) expect(out[i * 4 + 3]).toBe(0);
      else expect([...out.slice(i * 4, i * 4 + 4)]).toEqual([...src.slice(i * 4, i * 4 + 4)]);
    }
  });

  it('サイズ・フレーム数・表示時間・ループ指定を書き込む', () => {
    const gif = decodeGIF(
      encodeGIF(
        [
          { data: smallPalette(), delay: 500 },
          { data: manyColors(), delay: 80 },
        ],
        W,
        H
      )
    );
    expect(gif.width).toBe(W);
    expect(gif.height).toBe(H);
    expect(gif.loop).toBe(true);
    expect(gif.frames.map((f) => f.delay)).toEqual([500, 80]);
  });

  it('256 色を超えるフレームは近い色に減色される（約 2,700 色 → 256 色）', () => {
    const src = manyColors();
    const out = decodeGIF(encodeGIF([{ data: src, delay: 100 }], W, H)).frames[0].rgba;
    let worst = 0;
    let sum = 0;
    for (let i = 0; i < src.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const e = Math.abs(src[i + k] - out[i + k]);
        worst = Math.max(worst, e);
        sum += e;
      }
    }
    // median cut の実測は平均 9 / 最大 31。出現頻度順に上位色を採るだけの実装では最大 192 になっていた
    expect(sum / (W * H * 3)).toBeLessThanOrEqual(12);
    expect(worst).toBeLessThanOrEqual(40);
  });

  it('全面が透過のフレームも書き出せる', () => {
    const empty = new Uint8ClampedArray(W * H * 4);
    const out = decodeGIF(encodeGIF([{ data: empty, delay: 100 }], W, H)).frames[0].rgba;
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('表示時間は 20ms 未満を 20ms に切り上げる（ブラウザが極端に速い値を無視するため）', () => {
    const gif = decodeGIF(encodeGIF([{ data: smallPalette(), delay: 5 }], W, H));
    expect(gif.frames[0].delay).toBe(20);
  });
});
