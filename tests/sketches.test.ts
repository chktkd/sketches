import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SketchMeta } from '../src/meta';

const dir = resolve(import.meta.dirname, '..', 'sketches');
const slugs = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('sketches/<slug>', () => {
  it('スケッチが 1 つ以上ある', () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  it.each(slugs)('%s: index.html / main.ts / meta.ts がそろっている', (slug) => {
    for (const f of ['index.html', 'main.ts', 'meta.ts']) {
      expect(existsSync(resolve(dir, slug, f)), `${slug}/${f}`).toBe(true);
    }
  });

  // [hidden] の非表示を保証する共通 CSS。抜けると hidden にしたモーダルなどが出たままになる
  it.each(slugs)('%s: main.ts が共通の src/base.css を読み込む', (slug) => {
    const main = readFileSync(resolve(dir, slug, 'main.ts'), 'utf8');
    expect(main).toMatch(/import '\.\.\/\.\.\/src\/base\.css';/);
  });

  it.each(slugs)('%s: slug と meta.ts の形式が正しい', async (slug) => {
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    const meta = (await import(`../sketches/${slug}/meta.ts`)).default as SketchMeta;
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// sketch 固有のもの（テスト・フィクスチャを含む）は sketches/<slug>/ に置く。
// 共通の場所（tests/ と src/）から特定の sketch を名指しで import していたら、置き場所の誤り
describe('共通ディレクトリ', () => {
  const root = resolve(import.meta.dirname, '..');
  const shared = ['tests', 'src'].flatMap((d) =>
    readdirSync(resolve(root, d))
      .filter((f) => /\.(ts|mts|js|mjs)$/.test(f))
      .map((f) => `${d}/${f}`)
  );

  it.each(shared)('%s: 特定の sketch のファイルを import しない', (file) => {
    const src = readFileSync(resolve(root, file), 'utf8');
    expect(src).not.toMatch(/from\s+['"](?:\.\.\/)+sketches\/[a-z0-9-]+\//);
  });
});
