import { existsSync, readdirSync } from 'node:fs';
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

  it.each(slugs)('%s: slug と meta.ts の形式が正しい', async (slug) => {
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    const meta = (await import(`../sketches/${slug}/meta.ts`)).default as SketchMeta;
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
