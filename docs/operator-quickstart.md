# operator quickstart — fleamarket

**この文書は歩ける手順だけを書く。** 各 step の期待出力は `94c7327` の clean clone に
対する実測であり、書いてから fresh clone で踏み直して逐語一致を確認している。
歩けなかった手順は書いていない。

所要 10〜15 分。必要なのは `git` / `node` / `npx` / `dig` だけ。
**この repo をビルドする必要は無いし、現状ビルドできない**（step 2 がその理由を出す）。

実測環境: node v26.3.0 / npm 11.16.0 / pnpm 10.26.2 / macOS。

---

## step 1 — 取得して、いま何を見ているかを確定する

```bash
cd /tmp && rm -rf flea-walk
git clone --quiet git@github.com:cloud-itonami/fleamarket.git flea-walk
cd /tmp/flea-walk
git log -1 --format='%h %cI'
git ls-files | wc -l | tr -d ' '
```

抽出時点の commit なら `94c7327` が出る。tracked file は **25**。

`main` が進んでいたら以降の期待出力は一致しない。その場合は
`git checkout 94c7327` で固定してから続ける（この文書はその commit を測っている）。

---

## step 2 — 宣言されている `pnpm test` が走らないことを確認する

`kotoba/package.json` は `"test": "vitest run"` を宣言している。だが依存が入らない。

```bash
cd /tmp/flea-walk/kotoba
pnpm install 2>&1 | grep -o 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED' | head -1
```

→ `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

git 依存 `@etzhayyim/sdk` が build script (`prepare`) を要求するが
`onlyBuiltDependencies` に無い。エラーの指示どおり許可すると、**2 段目で落ちる**:

```bash
cd /tmp/flea-walk/kotoba
printf 'onlyBuiltDependencies:\n  - "@etzhayyim/sdk"\n  - "@etzhayyim/sdk-mock"\n' > pnpm-workspace.yaml
pnpm install 2>&1 | grep -o 'EALLOWSCRIPTS' | head -1
rm -f pnpm-workspace.yaml
ls node_modules 2>/dev/null | wc -l | tr -d ' '
```

→ `EALLOWSCRIPTS` が出て、`node_modules` は **0**。

pnpm が git 依存を用意するために内部で `npm install --allow-scripts` を呼ぶが、
npm 11 は project-scoped install でそのフラグを拒否する
(`--allow-scripts is not allowed in project-scoped installs`)。

**したがって committed の vitest スイートは一度も実行されていない。**
赤いのではなく沈黙している —— CI にこの repo の緑は無い。

> この 2 段目は pnpm と npm の版の組み合わせに依存する。別の環境では別の落ち方を
> しうる。1 段目（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）は package.json と
> lockfile の性質なので環境に依らない。**他環境での実測はしていない。**

---

## step 3 — 型検査を通し、error の本数と原因の数を分けて読む

```bash
cd /tmp/flea-walk/kotoba
npx --yes -p typescript@5.6 tsc --noEmit
```

期待（5 行、この順）:

```
src/registry.ts(7,32): error TS2307: Cannot find module '@etzhayyim/sdk' or its corresponding type declarations.
src/registry.ts(87,14): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/registry.ts(95,11): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/registry.ts(156,14): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/registry.ts(163,11): error TS7006: Parameter 'r' implicitly has an 'any' type.
```

**5 error だが独立した原因は 1 つ。** `@etzhayyim/sdk` が入らない（step 2）ので
`Etzhayyim` 型が解決できず、`e.read()` の戻りが `any` になり、その `.filter((r) => …)` /
`.map((r) => …)` の 4 箇所が `noImplicitAny` に当たる。SDK が入れば 4 件は消える。

> `npx --yes typescript@5.6 tsc …`（`-p` 無し）はこの環境では
> `could not determine executable to run` になる。`-p <pkg> <bin>` の形で呼ぶこと。

---

## step 4 — 依存ゼロでドメインを動かす

`src/` が外部モジュールを指す import は `registry.ts` の 1 行だけで、それは
`import type` ——実行時に消える。`read` / `write` を持つ値を渡せば全経路が動く。

まず 2 メソッドだけの in-memory ストアを置く（`kotoba/` の中に置く。
このディレクトリは `"type": "module"` を宣言しており、top-level await が要るため）:

```bash
cat > /tmp/flea-walk/kotoba/flea-stub.ts <<'EOF'
type Rec = { uri: string; value: any };
export function makeStore() {
  const db = new Map<string, Map<string, Rec>>();
  return {
    async read({ collection, rkey, cursor, limit }: any) {
      const col = db.get(collection) ?? new Map<string, Rec>();
      if (rkey !== undefined) { const r = col.get(rkey); return { records: r ? [r] : [] }; }
      const all = [...col.values()];
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + (limit ?? 50));
      const next = start + page.length;
      return { records: page, cursor: next < all.length ? String(next) : undefined };
    },
    async write({ collection, record, rkey }: any) {
      if (!db.has(collection)) db.set(collection, new Map());
      const uri = `at://did:web:fleamarket.etzhayyim.com/${collection}/${rkey}`;
      db.get(collection)!.set(rkey, { uri, value: record });
      return { uri };
    },
  };
}
EOF
```

次に検査本体:

```bash
cat > /tmp/flea-walk/kotoba/flea-check.ts <<'EOF'
import { createListing, getListing, listListings, closeListing,
         createBid, resolveBid, listBids, coverage } from "./src/index.js";
import { makeStore } from "./flea-stub.js";
const S = "did:web:alice.example.com", B = "did:web:bob.example.com";
let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`ok   ${label} = ${g}`); }
  else { fail++; console.log(`FAIL ${label} = ${g} (want ${w})`); }
};
const e: any = makeStore();
eq("create", (await createListing(e, { listingId: "L-1", sellerDid: S, title: "Vintage Camera", category: "electronics", priceMicros: "15000000", currency: "jpy", condition: "good" })).status, "created");
eq("currency uppercased", (await getListing(e, { listingId: "L-1" })).listing?.currency, "JPY");
eq("listing did", (await getListing(e, { listingId: "L-1" })).listing?.did, "did:web:fleamarket.etzhayyim.com:listing:l-1");
eq("duplicate", (await createListing(e, { listingId: "L-1", sellerDid: S, title: "dup", priceMicros: "1", currency: "JPY" })).status, "alreadyExists");
eq("reject bad sellerDid", (await createListing(e, { listingId: "X1", sellerDid: "nope", title: "x", priceMicros: "1", currency: "JPY" })).error, "invalidSellerDid");
eq("reject fractional price", (await createListing(e, { listingId: "X2", sellerDid: S, title: "x", priceMicros: "12.5", currency: "JPY" })).error, "invalidPriceMicros");
eq("reject bad currency", (await createListing(e, { listingId: "X3", sellerDid: S, title: "x", priceMicros: "1", currency: "JPYY" })).error, "invalidCurrency");
eq("reject bad condition", (await createListing(e, { listingId: "X4", sellerDid: S, title: "x", priceMicros: "1", currency: "JPY", condition: "mint" as any })).error, "invalidCondition");
eq("reject missing title", (await createListing(e, { listingId: "X5", sellerDid: S, title: "", priceMicros: "1", currency: "JPY" })).error, "missingRequiredFields");
eq("filter category", (await listListings(e, { category: "electronics" })).total, 1);
eq("search q substring", (await listListings(e, { q: "camera" })).total, 1);
eq("search q miss", (await listListings(e, { q: "bicycle" })).total, 0);
eq("filter status open", (await listListings(e, { status: "open" })).total, 1);
eq("bid created", (await createBid(e, { bidId: "B-1", listingId: "L-1", bidderDid: B, amountMicros: "9000000" })).status, "created");
eq("bid on ghost listing", (await createBid(e, { bidId: "B-X", listingId: "GHOST", bidderDid: B, amountMicros: "1" })).status, "listingNotFound");
eq("bid fractional amount", (await createBid(e, { bidId: "B-Y", listingId: "L-1", bidderDid: B, amountMicros: "1.5" })).error, "invalidAmountMicros");
eq("bid duplicate", (await createBid(e, { bidId: "B-1", listingId: "L-1", bidderDid: B, amountMicros: "1" })).status, "alreadyExists");
eq("list active bids", (await listBids(e, { listingId: "L-1", status: "active" })).total, 1);
eq("resolve accepted", (await resolveBid(e, { bidId: "B-1", resolution: "accepted" })).newStatus, "accepted");
eq("re-resolve rejected", (await resolveBid(e, { bidId: "B-1", resolution: "withdrawn" })).error, "bidNotActive:accepted");
eq("close sold", (await closeListing(e, { listingId: "L-1", outcome: "sold" })).newStatus, "sold");
eq("re-close rejected", (await closeListing(e, { listingId: "L-1", outcome: "closed" })).error, "listingNotOpen:sold");
eq("bid after sold", (await createBid(e, { bidId: "B-2", listingId: "L-1", bidderDid: B, amountMicros: "1" })).status, "listingClosed");
const cov = await coverage(e);
eq("coverage listings", cov.listingCount, 1);
eq("coverage bids", cov.bidCount, 1);
eq("coverage by status", [cov.listingsByStatus, cov.bidsByStatus], [{ sold: 1 }, { accepted: 1 }]);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
EOF
```

走らせる:

```bash
cd /tmp/flea-walk/kotoba && npx --yes -p tsx tsx flea-check.ts
```

期待（26 行 + 集計。`createdAt` は時刻に依るので一切印字していない）:

```
ok   create = "created"
ok   currency uppercased = "JPY"
ok   listing did = "did:web:fleamarket.etzhayyim.com:listing:l-1"
ok   duplicate = "alreadyExists"
ok   reject bad sellerDid = "invalidSellerDid"
ok   reject fractional price = "invalidPriceMicros"
ok   reject bad currency = "invalidCurrency"
ok   reject bad condition = "invalidCondition"
ok   reject missing title = "missingRequiredFields"
ok   filter category = 1
ok   search q substring = 1
ok   search q miss = 0
ok   filter status open = 1
ok   bid created = "created"
ok   bid on ghost listing = "listingNotFound"
ok   bid fractional amount = "invalidAmountMicros"
ok   bid duplicate = "alreadyExists"
ok   list active bids = 1
ok   resolve accepted = "accepted"
ok   re-resolve rejected = "bidNotActive:accepted"
ok   close sold = "sold"
ok   re-close rejected = "listingNotOpen:sold"
ok   bid after sold = "listingClosed"
ok   coverage listings = 1
ok   coverage bids = 1
ok   coverage by status = [{"sold":1},{"accepted":1}]

26 passed, 0 failed
```

これが「この repo は動く」の意味である —— **`pnpm install` が通らないことと、
ドメインが動かないことは別**。

---

## step 4b — 名前から予想できない挙動を出す

```bash
cat > /tmp/flea-walk/kotoba/flea-edges.ts <<'EOF'
import { createListing, listListings, closeListing, createBid, resolveBid, listBids, coverage } from "./src/index.js";
import { makeStore } from "./flea-stub.js";
const S = "did:web:alice.example.com", B = "did:web:bob.example.com";
const p = (l: string, v: unknown) => console.log(`${l.padEnd(46)} ${JSON.stringify(v)}`);
let e: any = makeStore();
await createListing(e, { listingId: "L-1", sellerDid: S, title: "Camera", priceMicros: "15000000", currency: "JPY" });
p("1 id case-folds: create 'l-1' after 'L-1'", (await createListing(e, { listingId: "l-1", sellerDid: S, title: "other", priceMicros: "1", currency: "JPY" })).status);
p("1 ...so listing count stays", (await coverage(e)).listingCount);
p("2 bid of 1 micro on a 15,000,000 listing", (await createBid(e, { bidId: "B-lo", listingId: "L-1", bidderDid: B, amountMicros: "1" })).status);
p("3 seller bids on own listing", (await createBid(e, { bidId: "B-self", listingId: "L-1", bidderDid: S, amountMicros: "999" })).status);
await closeListing(e, { listingId: "L-1", outcome: "sold" });
p("4 bids still active after listing sold", (await listBids(e, { status: "active" })).total);
p("4 ...and can still be resolved", (await resolveBid(e, { bidId: "B-lo", resolution: "accepted" })).status);
e = makeStore();
for (let i = 0; i < 120; i++) await createListing(e, { listingId: `P-${i}`, sellerDid: S, title: i === 119 ? "needle" : "hay", priceMicros: "1", currency: "JPY" });
p("5 coverage sees all 120", (await coverage(e)).listingCount);
p("5 listListings default total (page-local)", (await listListings(e)).total);
p("5 limit is capped at 200", (await listListings(e, { limit: 5000 })).total);
p("6 q='needle' at row 119, default limit 50", (await listListings(e, { q: "needle" })).total);
p("6 q='needle' with limit 200", (await listListings(e, { q: "needle", limit: 200 })).total);
e = makeStore();
p("7 PII in free-text title is accepted", (await createListing(e, { listingId: "L-9", sellerDid: S, title: "call 090-1234-5678, 1-2-3 Shibuya", priceMicros: "1", currency: "JPY" })).status);
p("8 condition omitted is fine", (await createListing(e, { listingId: "L-10", sellerDid: S, title: "x", priceMicros: "1", currency: "JPY" })).status);
p("9 priceMicros '0' accepted", (await createListing(e, { listingId: "L-11", sellerDid: S, title: "x", priceMicros: "0", currency: "JPY" })).status);
p("9 priceMicros negative rejected", (await createListing(e, { listingId: "L-12", sellerDid: S, title: "x", priceMicros: "-5", currency: "JPY" })).error);
p("10 bidderDid 'did:' prefix is the only check", (await createBid(e, { bidId: "B-9", listingId: "L-9", bidderDid: "did:", amountMicros: "1" })).status);
EOF
cd /tmp/flea-walk/kotoba && npx --yes -p tsx tsx flea-edges.ts
```

期待:

```
1 id case-folds: create 'l-1' after 'L-1'      "alreadyExists"
1 ...so listing count stays                    1
2 bid of 1 micro on a 15,000,000 listing       "created"
3 seller bids on own listing                   "created"
4 bids still active after listing sold         2
4 ...and can still be resolved                 "resolved"
5 coverage sees all 120                        120
5 listListings default total (page-local)      50
5 limit is capped at 200                       120
6 q='needle' at row 119, default limit 50      0
6 q='needle' with limit 200                    1
7 PII in free-text title is accepted           "created"
8 condition omitted is fine                    "created"
9 priceMicros '0' accepted                     "created"
9 priceMicros negative rejected                "invalidPriceMicros"
10 bidderDid 'did:' prefix is the only check   "created"
```

**6 が最も刺さる。** `q` は取得済みページの中しか見ないので、同じ問いが limit 次第で
0 件にも 1 件にもなる。呼び出し側は「無かった」と「まだ読んでいない」を区別できない。

**4 は分割の穴。** 閉じた出品への*新規*入札は拒否されるが、既存の入札は `active` の
まま残り、その後も解決できる。

---

## step 5 — appview が名乗るメソッドと、実装されているメソッドを突き合わせる

```bash
cd /tmp/flea-walk
grep -o '"[a-zA-Z]*"' appview/fleamarket-mcp-component/src/app.ts \
  | sed -n '/createListing/,/listTransactions/p' | tr -d '"' | sort > /tmp/flea-advertised.txt
grep -oE '^export (async function|function) [a-zA-Z]+' kotoba/src/registry.ts \
  | awk '{print $NF}' | sort > /tmp/flea-implemented.txt
echo "--- advertised but not implemented ---"; comm -23 /tmp/flea-advertised.txt /tmp/flea-implemented.txt
echo "--- implemented but not advertised ---"; comm -13 /tmp/flea-advertised.txt /tmp/flea-implemented.txt
```

期待:

```
--- advertised but not implemented ---
createTransaction
listTransactions
--- implemented but not advertised ---
coverage
resolveBid
```

名乗られているのに無い 2 つは、`kotoba/src/types.ts` が「決済はこちらに来ない」と
書いている当のものである。同じ 8 メソッドは `wrangler.jsonc` の `APP_CAPABILITIES` と
`bpmn/fleamarket.bpmn` の serviceTask 名にも現れる。

配備される側に `/health` が無いことも見ておく:

```bash
cd /tmp/flea-walk/appview/fleamarket-mcp-component
grep -c 'pathname === "/health"' src/app.ts
grep -rc health svelte/src/ | grep -v ':0$' || echo "(no health route under svelte/src)"
grep '"main"' wrangler.jsonc
```

期待: `src/app.ts` は 1 件、`svelte/src/` は 0 件（`(no health route under svelte/src)`
が出る）、`main` は `svelte/.svelte-kit/cloudflare/_worker.js`。
**つまり `/health` を返すファイルは配備されない。**

---

## step 6 — 配備状況を DNS で確認する

```bash
dig +short fleamarket.etzhayyim.com
dig +short fmdd4v30.etzhayyim.com
dig +short etzhayyim.com
```

**確かめるのは最初の 2 つが空であること**だけ。3 つ目は答えを返すが、Cloudflare の
anycast なので **IP の値も順序も実行ごとに変わる** —— 逐語一致で比較しない。

最初の 2 つが空である以上、appview はどちらの route でも応答しておらず、
controller の `did:web:fleamarket.etzhayyim.com` も解決できない
（`did:web` は `https://<host>/.well-known/did.json` を引くため）。

---

## step 7 — 片付ける

```bash
rm -f /tmp/flea-walk/kotoba/flea-stub.ts /tmp/flea-walk/kotoba/flea-check.ts \
      /tmp/flea-walk/kotoba/flea-edges.ts /tmp/flea-walk/kotoba/pnpm-workspace.yaml
rm -f /tmp/flea-advertised.txt /tmp/flea-implemented.txt
cd /tmp/flea-walk && git status --porcelain
```

`git status --porcelain` が何も出さなければ clone は元のままである。
消してよい: `rm -rf /tmp/flea-walk`。

---

## 次に手を付けるなら

この文書は現状を測っただけで、何も直していない。優先度順に:

1. **step 4b-6 の `q` のページ跨ぎ** —— 呼び出し側が誤りを検出できない唯一の項目。
2. **依存が入らないこと（step 2）** —— これが直るまで committed のテストは沈黙し続ける。
3. **advertised と実装の食い違い（step 5）** —— どちらが正かは決済の置き場所の決定で
   あって、この文書が決められることではない。
4. **`/health` が配備されない（step 5）** —— 監視を当てるなら先にこれ。
