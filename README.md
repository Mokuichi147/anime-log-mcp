# annict-mcp

[Annict](https://annict.com)(アニメ視聴記録サービス)の公式GraphQL APIを利用したMCP (Model Context Protocol) サーバーです。Cloudflare Workers上で動作します。

npmで公開されている `annict` パッケージはREST API v1をラップしたものでアーカイブ済みのため使用していません。本プロジェクトは以下の2つのパッケージで構成されます。

- `packages/annict-client` — Annict公式GraphQL API (`https://api.annict.com/graphql`) を直接操作する、Cloudflare Workersにも依存しない薄いTypeScriptクライアント
- `packages/mcp-server` — `annict-client` を使ってツールを公開する、Cloudflare Workers上のMCPサーバー([`agents`](https://www.npmjs.com/package/agents)パッケージの`McpAgent`を利用)

## セットアップ

### 1. 依存関係のインストール

```sh
npm install
```

### 2. Annict Personal Access Tokenの取得

1. https://annict.com/settings/apps を開く
2. 「個人用アクセストークン」から新規トークンを発行(読み取り専用/読み書き のスコープを選択)
3. 発行されたトークンは一度しか表示されないため控えておく

### 3. ローカル開発用のシークレット設定

`packages/mcp-server/.dev.vars.example` を `packages/mcp-server/.dev.vars` にコピーし、取得したトークンを設定します(`.dev.vars` は `.gitignore` 済みでコミットされません)。

```sh
cp packages/mcp-server/.dev.vars.example packages/mcp-server/.dev.vars
```

```
ANNICT_ACCESS_TOKEN=your_personal_access_token_here
MCP_AUTH_TOKEN=optional_shared_secret_for_bearer_auth
```

`MCP_AUTH_TOKEN` は任意です。設定した場合、MCPサーバーへのリクエストに `Authorization: Bearer <MCP_AUTH_TOKEN>` ヘッダーが必須になります。デプロイ後のWorker URLはデフォルトで公開されるため、本番運用時は設定を推奨します。

### 4. ローカル起動

```sh
npm run dev
```

`http://localhost:8787/mcp` でMCPサーバー(Streamable HTTPトランスポート)が起動します。動作確認には [MCP Inspector](https://github.com/modelcontextprotocol/inspector) か、以下のようなcurlでのJSON-RPC呼び出しが利用できます。

```sh
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 5. デプロイ

```sh
npx wrangler secret put ANNICT_ACCESS_TOKEN --config packages/mcp-server/wrangler.jsonc
# 必要であれば
npx wrangler secret put MCP_AUTH_TOKEN --config packages/mcp-server/wrangler.jsonc

npm run deploy
```

## 提供ツール

| ツール名 | 説明 |
|---|---|
| `annict_get_viewer` | 認証ユーザーのプロフィールと視聴ステータス件数を取得 |
| `annict_get_library_entries` | 認証ユーザーのライブラリ(視聴記録中の作品)を、ステータスで絞り込んで一覧取得 |
| `annict_search_works` | タイトル・シーズンで作品を検索 |
| `annict_get_work` | 数値の `annictId` で作品を1件取得 |
| `annict_get_episodes` | 作品の `annictId` からエピソード一覧を取得 |
| `annict_record_episode` | エピソードを視聴済みとして記録(コメント任意) |
| `annict_update_status` | 作品の視聴ステータスを更新 |

`annict_record_episode` の `episodeId` と `annict_update_status` の `workId` は、AnnictのRelay形式のグローバルID(各オブジェクトの `id` フィールド)です。数値の `annictId` とは異なるので注意してください。`annict_get_episodes` や `annict_search_works` のレスポンスに含まれる `id` フィールドを利用します。

## テスト

```sh
npm test
```

`annict-client` パッケージのvitestテストが実行されます(`fetch` をモックしたユニットテスト)。`mcp-server` パッケージには自動テストはなく、`npm run dev` + curl/MCP Inspectorでの手動確認を想定しています。

## 型チェック

```sh
npm run typecheck
```

## 今後の改善候補

- ライブのGraphQL introspectionを使った `graphql-code-generator` による型自動生成
- Annict GraphQL APIのレート制限に応じたリトライ/バックオフ
