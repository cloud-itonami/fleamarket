# fleamarket

C2C（個人間）フリマの **公開カタログ** — 出品（listing）と入札（bid）を AT PDS
レコードとして扱う参照実装と、その前段に立つ thin-edge appview。

`cloud-itonami/fleamarket`（旧 `etzhayyim/root` の `60-apps/etzhayyim-project-fleamarket`、
2026-06-01 抽出）。

**この repo の実質は `kotoba/` の 3 ファイル（約 420 行）である。** そこだけが
インストール無しで動き、他は未配備・未検証である。以下はすべて `94c7327` の
clean clone に対する実測で、歩ける手順は
[`docs/operator-quickstart.md`](docs/operator-quickstart.md) にある。

## 何が動くか

`kotoba/` はドメインの参照実装で、**依存を 1 つも入れずに走る。**

`src/` の中で外部モジュールを指す import は `registry.ts` の 1 行だけで、それは
`import type { Etzhayyim } from "@etzhayyim/sdk"` ——**型注釈なので実行時には消える**。
`types.ts` は import ゼロ。したがって `read` / `write` の 2 メソッドを持つ値さえ渡せば、
出品 → 入札 → 解決 → 集計の全経路が動く。quickstart の step 4 が 26 checks で実測する。

| 面 | 関数 |
|---|---|
| listing | `createListing` / `getListing` / `listListings` / `closeListing` |
| bid | `createBid`（FK→open な listing）/ `resolveBid` / `listBids` |
| 集計 | `coverage` |

書き込む先は 2 コレクション `com.etzhayyim.apps.fleamarket.listing` / `.bid`。
価格は **micros の 10 進文字列**（AT Lexicon に float が無く、bigint は JSON に
乗らないため）。identity は `did:web:fleamarket.etzhayyim.com:listing:{id}` 等。

設計上の分割（ADR-2606011400）は「**公開カタログだけがこちら側**、決済（エスクロー /
MoR）と配送（履行責任と住所 PII）は etzhayyim 側に残る」。`kotoba/` はこれを守っており、
金銭移動も PII も型に無い。

## 何が動かないか（実測）

1. **宣言されている `pnpm test` は一度も走ったことがない。** `pnpm install` が 2 段で
   落ちる（git 依存の build script が `onlyBuiltDependencies` に無い → 許可すると
   pnpm が内部で呼ぶ npm が `EALLOWSCRIPTS` で拒否する）。`node_modules` は 0 件で、
   committed の vitest スイート（`kotoba/test/fleamarket.test.ts`、`@etzhayyim/sdk-mock`
   が要る）は**赤いのではなく沈黙している**。手順と再現は quickstart step 2。
2. **`tsc --noEmit` は 5 error。** 独立した原因は `TS2307`（`@etzhayyim/sdk` 不在）の
   1 件だけで、残る `TS7006` 4 件はその派生（`Etzhayyim` 型が解決できないので
   `resp.records` が any になる）。step 3。
3. **appview はどこにも配備されていない。** `fleamarket.etzhayyim.com` も
   `fmdd4v30.etzhayyim.com` も DNS で解決しない（`etzhayyim.com` 自体は解決する）。
   したがって controller である `did:web:fleamarket.etzhayyim.com` も引けない。step 6。

## 読む前に知っておくべき食い違い

**この repo は自分が何をするものかについて 2 つの異なる答えを持っており、両者は
一致しない。** どちらか一方だけを読むと誤る。

- **`appview/.../src/app.ts` の `/health`・`wrangler.jsonc` の `APP_CAPABILITIES`・
  `bpmn/fleamarket.bpmn` の 3 つは同じ 8 メソッドを名乗る** ——そこには
  `createTransaction` / `listTransactions` が含まれる。これは `kotoba/src/types.ts` が
  「決済はこちらに来ない」と明記している当のものである。
- **`kotoba/` が実際に持つ 8 関数はそれとは別集合**で、`coverage` と `resolveBid` が
  あり、transaction 系は無い。

差分は quickstart step 5 が `comm` で機械的に出す（advertised−実装 =
`createTransaction`, `listTransactions` / 実装−advertised = `coverage`, `resolveBid`）。

### 読み手が開くファイルは、配備されるファイルではない

`wrangler.jsonc` の `main` は `svelte/.svelte-kit/cloudflare/_worker.js`
（SvelteKit のビルド出力）であって `src/app.ts` **ではない**。両者は挙動が違う:

| | `src/app.ts`（読まれる） | `svelte/src/`（配備される） |
|---|---|---|
| `/health`・`/_app/meta` | 返す | **どのルートも持たない** → `not_found_handling: "none"` で 404 |
| `/xrpc/<nsid>` の prefix 検査 | `com.etzhayyim.apps.fleamarket.` 必須 | **検査しない**（任意の nsid を転送） |
| 上流 | `DISPATCHER_URL` + `DISPATCHER_INTERNAL_SECRET` | `AGENTGATEWAY_MCP_ROUTER_URL`、secret 無し・client の `authorization` をそのまま転送 |

**`/health` でこのサービスを監視すると、配備されている側では 404 になる。**

さらに landing page（`svelte/src/routes/+page.svelte`）は `routeCount: 0` /
`routes: []` / `vars: []` を訪問者に表示するが、同じ component の `wrangler.jsonc` は
8 capability と 2 route を宣言している。埋め込まれた `relativePath` は今も抽出前の
monorepo パスを指す。

## 現状に無いもの

- **`kotoba/` が書く 2 つの NSID に lexicon が無い。** `etzhayyim/root` の
  `00-contracts/lexicons/com/etzhayyim/apps/` に在るのは `etzhayyim` / `hakken` /
  `kotoba` / `maps3d` / `murakumoFleet` の 5 つで、`fleamarket` は無い
  （remote main `0ba7feca` と一致する full-history checkout で確認）。
- **`NOTICE` が使用条件にしている `CHARTER-RIDER.md` がこの repo に無い。**
- **`fleamarket-ui-k6p4x2n9`** は `appview/README.md` の build / deploy コマンドが
  対象にしている作業ディレクトリだが、実体はこの repo に無い（`README` の散文にしか
  現れない）。したがって `appview/README.md` の 2 コマンドはどちらも実行できない。
- `README.edn` は自身を `com-etzhayyim-app-fleamarket` と名乗る。GitHub の redirect
  では今も `cloud-itonami/fleamarket` に解決するが、現在名ではない。

## ドメインの挙動で、名前から予想できないもの

断りのない項目は quickstart step 4b が実測して印字する。**バグと決めつけていない** ——
上位の層がどこまで担うかを知らずに直せる種類のものではない。ただし
知らずに使うと誤るものとして列挙する。

1. **`listingId` は小文字に畳まれる。** `L-1` と `l-1` は同じ出品になる。
   （`bidId` も `bidRkey` が同じ `toLowerCase` を使うので同様のはずだが、
   step 4b が実測しているのは `listingId` の側だけ。)
2. **`listListings` / `listBids` の `total` は全件数ではなく、取得したページ内の
   合致数。** 120 件あっても既定 `limit` 50 では `total` は 50。
3. **`q`（タイトル部分一致）は取得済みページの中しか見ない。** 120 件目に "needle"
   が在るとき、既定 limit では **0 件**、`limit: 200` では 1 件になる ——
   **見つからなかったのか、まだ読んでいないのかを呼び出し側は区別できない。**
4. **入札額と出品価格に関係が無い。** 15,000,000 micros の出品に 1 micro の入札が通る。
5. **出品者が自分の出品に入札できる。**
6. **出品が `sold` になっても、既存の入札は `active` のまま**で、その後も `resolveBid`
   できる。閉じた出品への**新規**入札だけが拒否される。
7. **PII の禁止は型と散文にあるだけで、強制されていない。** `title` / `description` は
   自由文字列なので電話番号や住所がそのまま通る。
8. `priceMicros` は `^\d+$` なので **`"0"` は通り**、負値と小数は拒否される。
9. `bidderDid` の検査は `startsWith("did:")` だけ。文字列 `"did:"` 単体が通る。

## レイアウト

```
kotoba/          ドメイン参照実装。ここだけが install 無しで動く
  src/types.ts     レコード型・検証・DID/rkey の導出（import ゼロ）
  src/registry.ts  listing / bid / coverage の全ロジック
  test/            vitest。@etzhayyim/sdk-mock が要り、現状 install できない
appview/fleamarket-mcp-component/
  src/app.ts       読まれるが配備されない thin-edge dispatcher
  svelte/          実際に配備される SvelteKit worker
  wrangler.jsonc   name: kotodama-fmdd4v30
bpmn/fleamarket.bpmn  8 serviceTask（appview 側の名乗りと一致、kotoba とは不一致）
migration.edn / README.edn / NOTICE / MIGRATION-TODO.md
```

## ライセンス

Apache License 2.0 + etzhayyim Charter Compliance Rider v3.1。`NOTICE` を参照
（ただし Rider 本文 `CHARTER-RIDER.md` はこの repo に無い）。
