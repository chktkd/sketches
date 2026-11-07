#!/usr/bin/env node
// 使い方: pnpm new <slug> ["タイトル"]
// sketches/<slug>/ に index.html / main.ts / meta.ts / style.css の雛形を作る
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [slug, title = slug] = process.argv.slice(2);
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(
    'slug は英小文字・数字・ハイフンで指定してください。例: pnpm new pixel-clock "ドット時計"'
  );
  process.exit(1);
}
const dir = resolve('sketches', slug);
if (existsSync(dir)) {
  console.error(`sketches/${slug} はすでにあります`);
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
mkdirSync(dir, { recursive: true });

const files = {
  'index.html': `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · sketches</title>
</head>
<body>
  <main class="wrap">
    <a class="back" href="../../">sketches /</a>
    <h1>${title}</h1>
    <canvas id="stage" width="320" height="180"></canvas>
  </main>
  <script type="module" src="./main.ts"></script>
</body>
</html>
`,
  'main.ts': `import '../../src/base.css';
import './style.css';

const stage = document.getElementById('stage') as HTMLCanvasElement;
const ctx = stage.getContext('2d')!;

function frame(t: number) {
  ctx.clearRect(0, 0, stage.width, stage.height);
  ctx.fillStyle = 'currentColor';
  ctx.fillRect(20 + Math.sin(t / 500) * 10, 20, 40, 40);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`,
  'meta.ts': `import { defineSketch } from '../../src/meta';

export default defineSketch({
  title: '${title.replaceAll("'", "\\'")}',
  description: 'TODO: 一言説明',
  date: '${today}',
  tags: [],
});
`,
  'style.css': `body { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f4f5f7; color: #1b2129; }
@media (prefers-color-scheme: dark) { body { background: #121519; color: #e3e7ec; } }
.wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px; }
.back { color: inherit; opacity: .6; text-decoration: none; font-size: 13px; }
canvas { width: 100%; height: auto; image-rendering: pixelated; border: 1px solid currentColor; }
`,
};
for (const [name, body] of Object.entries(files)) writeFileSync(resolve(dir, name), body);
console.log(
  `作成しました: sketches/${slug}/\n  pnpm dev で http://localhost:5173/sketches/${slug}/ を開けます`
);
