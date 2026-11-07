# sketches

[![CI](https://github.com/chktkd/sketches/actions/workflows/ci.yml/badge.svg)](https://github.com/chktkd/sketches/actions/workflows/ci.yml) [![Deploy](https://github.com/chktkd/sketches/actions/workflows/deploy.yml/badge.svg)](https://github.com/chktkd/sketches/actions/workflows/deploy.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Web 表現の小さなスケッチ集。どれもブラウザだけで動きます。

公開先: <https://chktkd.github.io/sketches/>

| スケッチ                                                                       | 内容                                                                 |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| [88x31 バナー工房](https://chktkd.github.io/sketches/sketches/88x31-banner/) | レイヤーとフレームで 88×31 バナーを作り、PNG／アニメ GIF で書き出す |

## 技術スタック

- TypeScript（strict）＋ Vite（マルチページ）
- pnpm / mise / Biome / Vitest
- ランタイム依存なし（外部から読むのは Google Fonts のみ）
- GitHub Actions → GitHub Pages

## 開発

```bash
mise install
pnpm install
pnpm dev            # http://localhost:5173/
pnpm test           # Vitest
pnpm lint           # Biome lint
pnpm format         # Biome format
pnpm build          # 型チェック + dist/ へビルド
```

## スケッチを追加する

```bash
pnpm new pixel-clock "ドット時計"
```

`sketches/<slug>/` に `index.html` / `main.ts` / `meta.ts` / `style.css` ができます。

- **ビルド対象**：`vite.config.ts` が `sketches/*/index.html` を自動でエントリーにします
- **一覧ページ**：`src/home.ts` が `sketches/*/meta.ts` を自動で集め、日付の新しい順に並べます

フォルダを足すだけで、ビルドにも一覧にも載ります。

## ディレクトリ構成

```text
.
├── index.html                # 一覧ページ
├── src/                      # 一覧ページと全 sketch 共通のもの（base.css / SketchMeta）
├── sketches/<slug>/          # 各スケッチ。固有のテストもここに置く（*.test.ts）
├── tests/                    # 全 sketch 共通の構成チェック
├── scripts/new-sketch.mjs    # 雛形生成
└── .github/workflows/        # CI / Pages デプロイ / dependency review
```

## デプロイ

`main` への push で `.github/workflows/deploy.yml` が動き、ビルドして GitHub Pages に公開します。
`actions/configure-pages` の `base_path`（`/sketches`）を `BASE_PATH` としてビルドに渡します。

## License

[MIT](LICENSE)
