# annict-mcp

[Annict](https://annict.com)(アニメ視聴記録サービス)の公式GraphQL APIを利用したMCP (Model Context Protocol) サーバーです。Cloudflare Workers上で動作します。

npmで公開されている `annict` パッケージはREST API v1をラップしたものでアーカイブ済みのため使用していません。本プロジェクトは以下の2つのパッケージで構成されます。

- `packages/annict-client` — Annict公式GraphQL API (`https://api.annict.com/graphql`) を直接操作する、Cloudflare Workersにも依存しない薄いTypeScriptクライアント
- `packages/mcp-server` — `annict-client` を使ってツールを公開する、Cloudflare Workers上のMCPサーバー([`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) v2 の `createMcpHandler` を利用)

プロトコルリビジョン **2026-07-28** に対応しています(下記「ステートレス化」を参照)。

## セットアップ

### 1. 依存関係のインストール

```sh
npm install
```

### 2. Annict OAuthアプリケーションの登録

1. https://annict.com/oauth/applications を開き、アプリケーションを新規作成する
2. **Redirect URI** に `https://<your-worker>.workers.dev/callback` を設定する
   - ローカル開発でも試す場合は `http://localhost:8000/callback` も追加する
3. 発行された **Client ID** と **Client Secret** を控える

このアプリケーションはデプロイ全体で1つだけ登録します。利用者ごとに登録する必要はありません。

### 3. KV namespaceの作成

OAuthのグラント・トークン・クライアント登録の保存先です。

```sh
npx wrangler kv namespace create OAUTH_KV --config packages/mcp-server/wrangler.jsonc
```

出力された `id` を `packages/mcp-server/wrangler.jsonc` の `kv_namespaces` に反映してください。

### 4. シークレットの設定

```sh
# 本番
npx wrangler secret put ANNICT_CLIENT_ID --config packages/mcp-server/wrangler.jsonc
npx wrangler secret put ANNICT_CLIENT_SECRET --config packages/mcp-server/wrangler.jsonc
```

ローカル開発では `packages/mcp-server/.dev.vars` に記述します(`.gitignore` 済み)。

```
ANNICT_CLIENT_ID=your_client_id
ANNICT_CLIENT_SECRET=your_client_secret
```

ここで設定するのは**アプリケーションの身元**であって、利用者の資格情報ではありません。利用者のAnnictトークンはOAuthフローで個別に取得され、grantに紐付けて保存されます。

### 5. 起動とデプロイ

```sh
npm run dev     # http://localhost:8000
npm run deploy
```

### 6. MCPクライアントからの接続

OAuthに対応したMCPクライアントであれば、URLを登録するだけです。クライアントが自動的に認可フローを開始します。

```json
{
  "mcpServers": {
    "annict": {
      "url": "https://<your-worker>.workers.dev/mcp"
    }
  }
}
```

初回接続時、ブラウザで以下が順に表示されます。

1. 本サーバーの同意画面(どのMCPクライアントに許可するかを確認)
2. Annictのログイン・認可画面

承認後、クライアントには**本サーバーが発行したトークン**が渡されます。Annictのトークンがクライアントに渡ることはありません。

## 認証の仕組み

このサーバーは2つの役割を持ちます。

- **MCPクライアントに対して**: 認可サーバー兼リソースサーバー。自前のアクセストークンを発行・検証する
- **Annictに対して**: 単一のOAuthクライアント。利用者ごとのAnnictトークンを取得し、grantに紐付けて保持する

```
ユーザーA ──┐                                        ┌── Annict (Aのトークン)
ユーザーB ──┼── 1つのデプロイ ── 1つのOAuthアプリ ──┼── Annict (Bのトークン)
ユーザーC ──┘                                        └── Annict (Cのトークン)
```

1つのデプロイを複数の利用者が共有でき、各自が自分のAnnictアカウントを操作します。

Annictトークンはgrantに紐付いた `props` として保存され、[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) がアクセストークンを鍵材料として暗号化します。ストレージを読めるだけでは復元できません。

> [!IMPORTANT]
> ただし、リクエスト処理中はサーバーのコード上で復号された状態のAnnictトークンが利用可能です。**デプロイした運営者は、利用者のAnnictアカウントとして操作できます。** これはホスティング型サービス一般と同じ信頼関係であり、構造的な回避策はありません。自分以外に使わせる場合はこの点を明示してください。

Annictに要求するスコープは `read write` です(視聴記録の作成・ステータス更新のため)。

## ステートレス化 (MCP 2026-07-28)

[2026-07-28リビジョン](https://modelcontextprotocol.io/specification/2026-07-28/changelog)でMCPはステートレスになりました。`initialize` / `notifications/initialized` のハンドシェイクとStreamable HTTPの `Mcp-Session-Id` ヘッダーが廃止され、各リクエストが `_meta` にプロトコルバージョンとクライアント能力を載せて自己完結します。サーバー側の能力表明は新設の `server/discover` が担います。

この変更に合わせ、本サーバーはセッションを保持しない構成になりました。

- **Durable Objectを廃止** — 以前はクライアントごとのセッションを`McpAgent`(Durable Object)が保持していました。セッションが無くなったため、`MCP_OBJECT` バインディングごと削除しています。どのWorkerアイソレートも任意のリクエストに応答できます
- **リクエストごとにサーバーインスタンスを生成** — `createMcpHandler` のファクトリが、そのリクエストが認証したAnnictトークンから `McpServer` を組み立てます。レスポンス後には何も残りません
- **唯一の永続状態はOAuth grant** — 利用者のAnnictトークンは従来どおりKVのgrantに暗号化保存され、リクエストごとに `ctx.props` として渡されます。これはMCPのセッションではなく認可状態です

`legacy: 'stateless'` (既定値) を指定しているため、2025リビジョンまでのクライアントも同じツール定義でそのまま接続できます。こちらもリクエストごとの処理で、セッションは作られません(GET/DELETEには405を返します)。

> [!NOTE]
> 2026-07-28では `ping` / `logging/setLevel` / SSEの再開(`Last-Event-ID`)なども廃止され、Roots・Sampling・Loggingが非推奨になりました。本サーバーはツールのみを公開しており、いずれも利用していません。

### アップグレード時の注意

既に旧バージョンをデプロイしている場合、Durable Objectクラスの削除を反映するマイグレーションが必要です。`wrangler.jsonc` に `v2` (`deleted_classes`) を追加済みなので、`npm run deploy` を実行すれば適用されます。`v1` の記述は削除しないでください(適用済みデプロイに対して `v2` を正しく適用するために必要です)。

## 提供ツール

| ツール名 | 説明 |
|---|---|
| `annict_get_viewer` | 認証ユーザーのプロフィールと視聴ステータス件数を取得 |
| `annict_get_user` | `username` を指定して他のAnnictユーザーのプロフィールと視聴ステータス件数を取得 |
| `annict_get_library_entries` | 認証ユーザーのライブラリ(視聴記録中の作品)を、ステータスで絞り込んで一覧取得 |
| `annict_search_works` | タイトル・シーズンで作品を検索 |
| `annict_get_work` | 数値の `annictId` で作品を1件取得 |
| `annict_get_episodes` | 作品の `annictId` からエピソード一覧を取得 |
| `annict_search_characters` | 名前(または `annictId`)でアニメのキャラクターを検索。所属シリーズも一緒に返します |
| `annict_search_people` | 名前(または `annictId`)で声優・監督などの人物を検索 |
| `annict_search_organizations` | 名前(または `annictId`)で制作会社・スタジオを検索 |
| `annict_record_episode` | エピソードを視聴済みとして記録(コメント任意) |
| `annict_update_status` | 作品の視聴ステータスを更新 |

一覧系のツール(`annict_get_library_entries` / `annict_search_works` / `annict_get_episodes` / `annict_search_characters` / `annict_search_people` / `annict_search_organizations`)はカーソルページネーションに対応しています。レスポンスの `pageInfo.hasNextPage` が `true` のとき、`pageInfo.endCursor` を次の呼び出しの `after` に渡すと続きを取得できます。`first` の既定値は25件です。

`annict_record_episode` の `episodeId` と `annict_update_status` の `workId` は、AnnictのRelay形式のグローバルID(各オブジェクトの `id` フィールド)です。数値の `annictId` とは異なるので注意してください。`annict_get_episodes` や `annict_search_works` のレスポンスに含まれる `id` フィールドを利用します。

## テスト

```sh
npm test
```

両パッケージのvitestテストが実行されます。

- `annict-client` — `fetch` をモックしたユニットテスト
- `mcp-server` — `@modelcontextprotocol/client` v2 を `2026-07-28` にピン留めして、HTTPハンドラーをプロセス内で叩く結合テスト。ハンドシェイク無しの `tools/list`、`Mcp-Session-Id` が返らないこと、リクエスト間で状態が共有されないことを確認しています

## 型チェック

```sh
npm run typecheck
```

## 今後の改善候補

- ライブのGraphQL introspectionを使った `graphql-code-generator` による型自動生成
- Annict GraphQL APIのレート制限に応じたリトライ/バックオフ
