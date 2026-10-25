# anime-log-mcp

[Annict](https://annict.com)(アニメ視聴記録サービス)の公式GraphQL APIを利用した、非公式のMCP (Model Context Protocol) サーバーです。Annictの運営とは関係ありません。Cloudflare Workers上で動作します。

[API利用規約](https://annict.com/terms/api)第13条は、アプリケーションの名前にAnnictの名称を冠することを、公式のものと誤解させる表示として禁じています。そのため、本サーバーとWorkerの名前、公開しているURLのどれにもAnnictを含めていません。デプロイするときは、Annictに登録するOAuthアプリケーションの名前やドメインにもAnnictを含めないでください。

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

1. https://annict.com/oauth/applications を開き、アプリケーションを新規作成する。名前にAnnictを含めない(第13条)
2. **Redirect URI** に `https://<your-domain>/callback` を設定する
   - ローカル開発でも試す場合は `http://localhost:8000/callback` も追加する
3. 発行された **Client ID** と **Client Secret** を控える

このアプリケーションはデプロイ全体で1つだけ登録します。利用者ごとに登録する必要はありません。

> [!NOTE]
> [API利用規約](https://annict.com/terms/api)第12条により、登録したOAuthアプリケーションは第三者に譲渡できません。運用を別の人に引き継ぐときは、引き継ぐ人の名義でアプリケーションを新しく登録してシークレットを差し替え、利用者に改めて許可してもらってください。

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

`packages/mcp-server/wrangler.jsonc` の `routes` には、本リポジトリのデプロイ先のCustom Domainが書かれています。自分のドメインに書き換えてください。`vars` はURLを移転するときだけ必要です(「URLを移転する」を参照)。移転しないなら削除してください。workers.devのURLで公開する場合は、`routes` を削除して `workers_dev` を `true` にします。

```sh
npm run dev     # http://localhost:8000
npm run deploy
```

### 6. MCPクライアントからの接続

OAuthに対応したMCPクライアントであれば、URLを登録するだけです。クライアントが自動的に認可フローを開始します。

```json
{
  "mcpServers": {
    "anime-log": {
      "url": "https://<your-domain>/mcp"
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

## Annict API利用規約への対応

2026年11月25日施行の[API利用規約](https://annict.com/terms/api)に沿うよう、次のとおり扱っています。

### 保存する利用者情報と削除 (第6条・第7条)

このデプロイが利用者ごとに保存するのは、OAuth grantに紐付いた次の情報だけです。APIから取得した作品情報や記録はリクエストのたびに取得して返すだけで、保存もキャッシュもしません。

| 情報 | 保存のされ方 |
|---|---|
| Annictのアクセストークン・ユーザー名 | grantの `props` として暗号化して保存 |
| AnnictのユーザーID(数値)・ユーザー名 | grantの `userId` / `metadata` として平文で保存(運用者がgrantを特定するため) |

これらは次のときに削除されます。

- **利用者がAnnictで連携を解除したとき** — Annictが401を返すようになるので、次にツールが呼ばれた時点で、その利用者のgrantをすべて失効させます。別のMCPクライアントで許可した分も含め、上記の情報とgrantから発行したトークンをすべて削除します。Annictでの連携の解除はアプリ単位なので、401が返った時点で、その利用者のAnnictトークンはどのgrantのものも無効になっています。削除の対象はリクエストを受け付けた時点で決めるため、Annictの応答を待つ間にMCPのトークンが期限切れになっても削除されます
- **許可から30日経ったとき** — grantの有効期限(`refreshTokenTTL`)が切れるとKVから自動で消え、利用者は改めて許可します。トークンを更新しても期限は延びません

連携を解除したあとツールが一度も呼ばれなかった場合は、30日の期限で削除されます。

### 運用をやめるとき (第7条)

API利用規約は、APIの利用をやめたときにすべての利用者情報を削除するよう求めています。運用をやめるときは、Workerを削除するだけでなく `OAUTH_KV` のnamespaceも削除し、Annictに登録したOAuthアプリケーションも削除してください。

```sh
npx wrangler delete --config packages/mcp-server/wrangler.jsonc
npx wrangler kv namespace delete --binding OAUTH_KV --config packages/mcp-server/wrangler.jsonc
```

### レート制限 (第11条)

Annict APIのレート制限は、アクセストークンと接続元IPの組ごとに1分あたり600リクエストです(2026年10月25日時点。最新の値は[開発者向けヘルプ](https://wikino.app/s/annict/pages/357)を確認してください)。上限を超えると、Annictは `Retry-After` ヘッダー付きの429を返します。

- `Retry-After` が10秒以内なら、その秒数だけ待ってから1回だけ再送します
- それより長い場合や再送も429だった場合は、ツールの結果を `isError: true` とし、待つべき秒数をメッセージに含めて返します(`retry after N seconds`)
- OAuthの認可中(トークン発行とユーザーの確認)に429を受けたときは、待つべき秒数を書いたエラーページを表示します

`annict-client` を単体で使う場合は、`rateLimitMaxWaitSeconds` でその場で待つ秒数の上限を変えられます(0でその場では待ちません)。429は `AnnictRateLimitError` として投げられ、`retryAfterSeconds` で待つべき秒数を取れます。

## URLを移転する

デプロイのURLを変えるときは、同じWorkerで新旧両方のドメインを受けると、旧URLの利用者を締め出さずに移行できます。KVとシークレットはそのまま共有されます。

MCPクライアントはトークンを接続先のURLに紐付けて保存するため、利用者は一度だけURLを変えて許可し直す必要があります。トークンのaudienceもURLごとに異なります。本サーバーはそれを促すため、旧URLへのリクエストに次のように応答します。

| 期間 | 旧URLでの動作 |
|---|---|
| `LEGACY_SUNSET` まで | すべて従来どおり動きます。ツールの結果の末尾とMCPの `instructions` に移転先を添え、トップページと同意画面に案内を表示します |
| `LEGACY_SUNSET` 以降 | ツールはAnnictを呼ばずに、移転先を伝えるエラーを返します。`/authorize` とトップページは案内ページ(410)だけを返し、新しいgrantは発行しません |

`LEGACY_SUNSET` 以降は旧URLでgrantが発行されません。旧URLのgrantは遅くとも30日後にすべて期限切れになり、そのあとクライアントが再認可しようとすると案内ページが表示されます。

### 手順

1. Annictに登録したOAuthアプリケーションの **Redirect URI** に `https://<新しいドメイン>/callback` を追加します。旧ドメインのものは残しておきます
2. Workerに新しいドメインをCustom Domainとして追加します。旧ドメインも外さないでください
3. `wrangler.jsonc` の `vars` に次を設定してデプロイします

   ```jsonc
   "vars": {
     "CANONICAL_ORIGIN": "https://<新しいドメイン>",
     "LEGACY_ORIGINS": "https://<旧ドメイン>",          // カンマ区切りで複数指定できます
     "LEGACY_SUNSET": "2026-11-24T23:59:59+09:00"      // 省略すると旧URLは動き続けます
   }
   ```

4. 利用者に新しいURLを知らせます
5. `LEGACY_SUNSET` から30日以上経ったら、旧ドメインをWorkerから外し、旧Redirect URIを削除して、`vars` の3項目を消します。旧ドメインを長く残すほど、移行し忘れた利用者に案内を見せられる期間は延びます

本リポジトリのデプロイは、この仕組みで `https://annict-mcp-server.mokuichi147.com` から `https://anime-log-mcp.mokuichi147.com` へ移転中です。期限は2026年11月24日です。

### Worker名を変えるとき

Worker名を変えて(例: `annict-mcp-server` → `anime-log-mcp`)デプロイすると、Cloudflare上では別のWorkerとして作られます。シークレットは引き継がれず、旧ドメインは旧Workerに付いたままです。次の順で切り替えます。

1. 新しいWorkerにシークレットを設定します。Workerがまだ無い場合は、作成してよいか確認されます

   ```sh
   npx wrangler secret put ANNICT_CLIENT_ID --config packages/mcp-server/wrangler.jsonc
   npx wrangler secret put ANNICT_CLIENT_SECRET --config packages/mcp-server/wrangler.jsonc
   ```

2. `npm run deploy` を実行します。旧ドメインは旧Workerに付いているため、新しいWorkerに付け替えてよいか確認されるので、承認します。KVは同じnamespaceを指しているので、旧URLで発行したgrantもそのまま使えます
3. 新旧両方のドメインで動作を確認したら、旧Workerを削除します。旧Workerのworkers.devのURLもこれで無くなります

   ```sh
   npx wrangler delete --name annict-mcp-server
   ```

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
