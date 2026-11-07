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
- スケッチは `sketches/<slug>/` に `index.html` / `main.ts` / `meta.ts` をそろえて置く。`vite.config.ts` がビルド対象に、`src/home.ts` が一覧に自動で載せるので、設定ファイルや一覧を手で編集しない（`tests/sketches.test.ts` が構成を検査する）
- localStorage は全スケッチで同じオリジン（`chktkd.github.io`）を共有する。キーは `sketch:<slug>:...` の形にして衝突させない
- スケッチはブラウザだけで完結させる。外部 API や secrets を前提にしない

## Production Impact

- `main` への push で `.github/workflows/deploy.yml` が GitHub Pages（https://chktkd.github.io/sketches/）へ公開する
- リポジトリは public。リポジトリ設定は `github-terraform` で管理する
- secrets なし

## Project-Specific Notes

- public repo のため、private の `common-github-actions` の reusable workflow を参照できない。CI は `node-ci.yml` と同じ手順・同じピン留めを `ci.yml` に直接書いている。`node-ci.yml` を更新したら、こちらも合わせる
- 公開先は handbook の Deployment Standards（公開サイトは Vercel / Cloudflare Pages）と異なり、GitHub Pages を選んでいる。ビルド成果物が静的ファイルだけで、リポジトリと公開先を1か所で完結させるため
- GIF エンコーダは `sketches/88x31-banner/gif.ts` に自前実装している。`tests/gif.test.ts` がテスト用デコーダ（`tests/gif-decode.ts`）でのラウンドトリップを検証する
