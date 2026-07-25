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
MCP_AUTH_TOKEN=
```

`MCP_AUTH_TOKEN` は**必須**です。MCPサーバーへのリクエストには `Authorization: Bearer <MCP_AUTH_TOKEN>` ヘッダーが必要になります。値は自分で生成してください(例: `openssl rand -hex 32`)。

デプロイ後のWorker URLはデフォルトで公開されます。このサーバーは書き込み権限を持つAnnictトークンを保持しているため、`MCP_AUTH_TOKEN` が未設定のままだとURLを知った第三者があなたのAnnictアカウントに書き込めてしまいます。未設定の場合はリクエストを `500` で拒否します。

### 4. ローカル起動

```sh
npm run dev
```

`http://localhost:8787/mcp` でMCPサーバー(Streamable HTTPトランスポート)が起動します。動作確認には [MCP Inspector](https://github.com/modelcontextprotocol/inspector) か、以下のcurlが利用できます。

Streamable HTTPでは `initialize` 以外のリクエストに `Mcp-Session-Id` ヘッダーが必須なので、まず `initialize` でセッションIDを取得します。

```sh
# 1. initialize してレスポンスヘッダー mcp-session-id を取得
curl -i -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# 2. 取得したセッションIDを付けて tools/list
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Mcp-Session-Id: <1で取得したID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

### 5. デプロイ

```sh
npx wrangler secret put ANNICT_ACCESS_TOKEN --config packages/mcp-server/wrangler.jsonc
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

一覧系の3ツール(`annict_get_library_entries` / `annict_search_works` / `annict_get_episodes`)はカーソルページネーションに対応しています。レスポンスの `pageInfo.hasNextPage` が `true` のとき、`pageInfo.endCursor` を次の呼び出しの `after` に渡すと続きを取得できます。`first` の既定値は25件です。

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
