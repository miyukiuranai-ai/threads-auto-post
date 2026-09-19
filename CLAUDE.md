# threads-auto-post — Claude への共通の指示

## 何のツールか
- Threads の複数名義を、公式 Threads API だけで一括して自動投稿する（ブラウザ自動化はしない）。
- 文章は人が「文章ストック」に入れる。**AI に文章を考えさせない。承認の手順も無い。** 入れた文章がそのまま出る。
- Next.js（App Router）を Vercel Hobby にデプロイ。データは Firestore、画像・動画は Firebase Storage。
- 秘密情報は `.env.local` と Vercel の環境変数だけに置く。コードに書かない。チャットに貼らない。
- threads-ops-2（同じ持ち主の別ツール）とは Firebase プロジェクトも Apps Script も別。あちらには触れない。

## 構成
- `lib/server/*.mjs` がサーバー側の本体。`app/_actions/*.js` がサーバーアクション、`app/api/cron/*` が定期実行の入口。
  - `templates.mjs` 文章ストック（取り込み・名義ごとの一巡）、`schedule.mjs` 自動投稿の設定、`auto.mjs` 枠の判定と投稿の作成、
    `publish.mjs` Threads への送信（コンテナ作成 → 準備待ち → 公開。準備待ちは次回に引き継ぐ）、`tick.mjs` 5分おきの本体。
  - `time.mjs` 日本時間の扱い（保存は ISO/UTC、画面と設定は日本時間）。
- 投稿の状態: scheduled → publishing → posted / failed。ほかに missed（時刻切れ）、canceled、skipped（見送り）、deleted。
- 自動投稿の投稿 ID は `auto-<名義>-<日付>-<時刻>` / `auto-<名義>-i<ms>` で、二重に作らない。
- Firestore の問い合わせは等値と単一フィールドの範囲だけ（複合インデックス不要）。名義ごとの一巡（`accounts.templateCycle`）でストック全体を読み直さない。

## コードの決まり
- コメントと画面の文言は日本語。読み手は開発者でない運用者なので、専門用語を避け、なぜそうするかを書く。
- `next build` は開発サーバーを止めてから実行する。
- 変更は小さくコミットし、`main` に push すると Vercel に自動デプロイされる。
- 新しい機能を足したら `docs/OPERATOR.md` にも一段落足す。
