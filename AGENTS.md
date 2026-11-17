# sketches-ai-docs

## Communication

- Respond in Japanese

## Commands

- 開発: `pnpm dev`
- テスト: `pnpm test`
- lint: `pnpm lint` / `pnpm format:check` / `pnpm typecheck`（CI は `.github/workflows/ci.yml` で `lint` / `format:check` / `typecheck` / `test` / `build` を実行）
- 新しいスケッチ: `pnpm new <slug> "タイトル"`

## Critical Rules

- package manager は pnpm。`pnpm-lock.yaml` を手で編集しない
- ts / json は Biome、css / md / yaml は Prettier が整形する（`biome.json` で css と html を除外している）
- sketch 固有のもの（コード・テスト・テスト用ヘルパー・フィクスチャ）はすべて `sketches/<slug>/` に置く。`tests/` と `src/` は全 sketch に共通のもの（構成チェック、一覧ページ、`base.css`、`SketchMeta`）だけにする（`tests/sketches.test.ts` が共通ディレクトリから特定の sketch を import していないか検査する）
- スケッチは `sketches/<slug>/` に `index.html` / `main.ts` / `meta.ts` をそろえて置く。`vite.config.ts` がビルド対象に、`src/home.ts` が一覧に自動で載せるので、設定ファイルや一覧を手で編集しない（`tests/sketches.test.ts` が構成を検査する）
- localStorage は全スケッチで同じオリジン（`chktkd.github.io`）を共有する。キーは `sketch:<slug>:...` の形にして衝突させない
- スケッチはブラウザだけで完結させる。外部 API や secrets を前提にしない

## Production Impact

- `main` への push で `.github/workflows/deploy.yml` が GitHub Pages（https://chktkd.github.io/sketches/）へ公開する
- リポジトリは public。リポジトリ設定は `github-terraform` で管理する
- secrets なし

## Project-Specific Notes

- public repo のため、private の `common-github-actions` の reusable workflow を参照できない。CI は `node-ci.yml` と同じ手順・同じピン留めを `ci.yml` に直接書いている。`node-ci.yml` を更新したら、こちらも合わせる
- `renovate.json` は private の preset（`chktkd/renovate-settings` の `default.json` と `automerge.json`）の内容を直接書いている。`extends` で参照すると "Cannot find preset's package" で Renovate が止まったため（sketches#1）。preset を変えたら、こちらも合わせる。
- 公開先は handbook の Deployment Standards（公開サイトは Vercel / Cloudflare Pages）と異なり、GitHub Pages を選んでいる。ビルド成果物が静的ファイルだけで、リポジトリと公開先を1か所で完結させるため
- GIF エンコーダは `sketches/88x31-banner/gif.ts` に自前実装している。同じディレクトリの `gif.test.ts` が、テスト用デコーダ（`gif-decode.ts`）でのラウンドトリップを検証する
- 現状は単一パッケージ（devDependencies をルートで共有）。sketch ごとに依存のバージョンやビルドツールを変えたくなったら、pnpm workspace と CI の matrix に移す

## リリース
- `main` への push ごとに `.github/workflows/release.yml` が、前回 tag 以降のコミット subject から版を決めて tag と GitHub Release を作る。ファイル内の version は更新しない
- subject は Conventional Commits に従う。`feat:` は minor、それ以外は patch
- `!`（例: `feat!:`）を付けるのは、既存の利用者が壊れる変更だけにする。環境変数・設定・DB や BigQuery のスキーマ・デプロイ手順など、既存の運用が変更なしでは動かなくなる変更が該当する。新機能や任意オプションの追加は `feat:` とする。`BREAKING CHANGE` フッターだけでは major と判定されない
