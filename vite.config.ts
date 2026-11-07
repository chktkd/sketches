import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/** sketches/<slug>/index.html を自動でエントリーにする。フォルダを足すだけで公開対象になる */
function sketchEntries(): Record<string, string> {
  const dir = resolve(root, 'sketches');
  const entries: Record<string, string> = { home: resolve(root, 'index.html') };
  for (const slug of readdirSync(dir)) {
    const html = resolve(dir, slug, 'index.html');
    if (existsSync(html)) entries[slug] = html;
  }
  return entries;
}

export default defineConfig({
  // GitHub Actions では configure-pages が返す "/sketches" に "/" を足して BASE_PATH で渡す
  base: process.env.BASE_PATH ?? '/',
  build: {
    outDir: 'dist',
    rollupOptions: { input: sketchEntries() },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
