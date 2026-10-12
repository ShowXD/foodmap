# Cloudflare 設定步驟

美食地圖的網頁、API 和資料庫都放在 Cloudflare，登入用全家共用的「家庭密碼」。
兩份設定文件請依這個順序做：**Cloudflare（本文件）→ [LINE](line.md)**。LINE 需要用到這裡部署出來的網址。
「AI 自動填入」用的是 Cloudflare Workers AI 的免費額度，不需要另外申請 AI 帳號或金鑰。全部步驟都**不需要綁信用卡**。

> ℹ️ 第 5 步設好家庭密碼之前，網站會一律回「登入尚未設定」（HTTP 503）。網站在沒設密碼時是鎖住的，不會變成公開。

全部指令都在 repo 根目錄執行。

---

## 0. 安裝專案內的 wrangler

wrangler 已列在 `package.json` 的 `devDependencies`，版本鎖在 `package-lock.json`，只裝在這個專案的 `node_modules/`，不會影響其他專案：

```bash
npm install
```

之後文件裡的 `npx wrangler ...` 都會用專案內這一份。

> **不要寫成 `npx wrangler@4`。** 指定版本的寫法會另外從 npm 下載一份，不是用專案裡鎖定的版本。
> 另外要注意：`wrangler login` 的登入狀態存在使用者層級，所有專案共用同一個 Cloudflare 帳號。

## 1. 建立帳號並登入 wrangler

1. 到 <https://dash.cloudflare.com/sign-up> 註冊（免費方案就夠）。
2. 在終端機登入，瀏覽器會跳出授權頁面：

   ```bash
   npx wrangler login
   ```

## 2. 建立 D1 資料庫

下面是**兩個獨立的指令**，請依序分開執行：

**2-1 建立資料庫**（`--location apac` 讓資料庫放在亞太區，台灣連線比較快）：

```bash
npx wrangler d1 create foodmap --location apac
```

輸出會有一行 `database_id = "xxxxxxxx-..."`。把它貼到 [`wrangler.toml`](../../wrangler.toml)，取代 `REPLACE_WITH_D1_DATABASE_ID`。

> 這個 ID 不是密碼，但也沒必要公開。要不要 commit 隨你；不想公開的話，就只留在本機、不要 commit 這一行。

**2-2 套用資料表結構到雲端資料庫**（記得加 `--remote`，不加會只套到本機）：

```bash
npx wrangler d1 execute foodmap --remote --file=./schema.sql
```

## 3. 建立 Pages 專案並第一次部署

```bash
npx wrangler pages project create foodmap
npm run deploy
```

- `npm run deploy` 就是 `wrangler pages deploy`，會依 `wrangler.toml` 的 `pages_build_output_dir` 上傳 `public/`，連同 `functions/` 一起部署。
- 部署完會得到網址 `https://foodmap.pages.dev`。如果名字被用掉了，會是你自己取的專案名稱。

## 4. 確認 D1 與 Workers AI 綁定

`wrangler.toml` 已經宣告了 `DB`（D1）和 `AI`（Workers AI）兩個綁定，用 `wrangler pages deploy` 部署會自動帶上。可以到控制台確認：

**Workers & Pages** → `foodmap` → **Settings** → **Bindings**，應該看到：

- D1 database：`DB` → `foodmap`
- Workers AI：`AI`

如果少了，就手動 **Add** 補上（D1 選 **D1 database bindings**、AI 選 **Workers AI**，Variable name 分別填 `DB`、`AI`），然後**重新部署一次**（綁定在下次部署才會生效）。

### Workers AI 免費額度

- 每天 10,000 neurons，UTC 00:00（台灣早上 8 點）重置。
- 一次擷取約 70 neurons，**每天大約可以免費用 140 次**。
- 免費方案超過額度時只會失敗、不會扣款，App 會顯示「AI 暫時無法使用」，手動填寫照常能用。
- 用量可以在控制台的 **AI** → **Workers AI** 查看。

## 5. 設定家庭密碼與金鑰（secret）

密碼和金鑰只能放在 Cloudflare secret，**絕對不要寫進任何會被 commit 的檔案**，也不要貼到聊天或截圖裡。

### 5-1 家庭密碼 `FAMILY_PASSWORD`

全家共用的登入密碼。建議用 4 個以上不相關的詞組成，例如「藍色 腳踏車 鳳梨 圖書館」這種形式，**不要照抄這個範例**。

```bash
npx wrangler pages secret put FAMILY_PASSWORD
```

指令會要你貼上值，輸入時不會顯示在畫面上。

### 5-2 簽章金鑰 `SESSION_SECRET`

這把金鑰只用來簽登入 cookie，家人不需要知道。用下面這行直接產生隨機值並存進去，值不會顯示在畫面上：

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler pages secret put SESSION_SECRET
```

### 5-3 重新部署

```bash
npm run deploy
```

secret 在下次部署後才會生效。

### 之後要換密碼

再執行一次 5-1 並重新部署。**所有已登入的人都會被自動登出**，要用新密碼重新登入。懷疑密碼外洩時就這樣做。

### LINE 的金鑰

`LINE_CHANNEL_SECRET` 的設定方式見 [line.md](line.md)。

### 本機開發

- 本機用的密碼放在 repo 根目錄的 `.dev.vars`（`.gitignore` 已排除），一行一個，例如：

  ```
  FAMILY_PASSWORD=本機測試用的密碼
  SESSION_SECRET=本機測試用的隨機字串
  ```

- **`npm run dev` 必須先 `npx wrangler login`。** `wrangler.toml` 裡的 AI 綁定一定要連到 Cloudflare。
- 第一次在本機跑時，如果出現 `You need to register a workers.dev subdomain`，到控制台 **Workers & Pages** 依畫面指示註冊一個 workers.dev 子網域（免費、不用綁卡）就好。
- 本機測試 AI 的用量也算在同一份免費額度裡。

## 6. 驗證

```bash
# 沒登入：網頁會被導到 /login（HTTP 302），API 回 401
curl -sI https://foodmap.pages.dev/ | head -5
curl -si https://foodmap.pages.dev/api/places | head -5

# LINE webhook 不需要登入（安全性改由 LINE 簽章把關）；第四階段完成前會回 405
curl -si -X POST https://foodmap.pages.dev/api/line/webhook | head -5
```

網址換成你自己的 Pages 網址；如果專案名稱被用掉，會是像 `foodmap-xxx.pages.dev` 這樣。

最後用手機開網址，輸入家庭密碼登入，再把網頁「加到主畫面」安裝成 App。登入狀態會保留 30 天。

### 登入怎麼運作（給之後維護的人）

- `functions/_middleware.js` 會擋下所有沒登入的請求，**包含每次部署產生的預覽網址**。只放行 `/login`、`/api/login`、`/api/line/webhook`、`/icon.svg`。
- 登入成功後會發一個 HttpOnly、Secure、SameSite=Lax 的 cookie，內容是到期時間加上 HMAC 簽章，用 `SESSION_SECRET` 和 `FAMILY_PASSWORD` 一起簽。
- 密碼錯誤時固定延遲 1 秒。如果發現有人大量猜密碼，可以在 Cloudflare 控制台對 `/api/login` 加一條 Rate limiting rule。

---

## 之後更新程式

```bash
npm run deploy
```

### 資料表結構有變動時

`migrations/` 資料夾裡的 SQL 檔是給**已經建好的資料庫**升級用的，依編號順序各執行一次就好，**要在部署新程式之前執行**：

```bash
npx wrangler d1 execute foodmap --remote --file=./migrations/<檔名>.sql
```

| 檔案 | 內容 | 誰需要跑 |
|---|---|---|
| `0002_multi_place.sql` | 一則影片可以存多家店（拿掉網址不可重複的限制，資料保留） | 2026-10-12 以前用 `schema.sql` 建的資料庫 |

全新建立的資料庫只要跑 `schema.sql`，它已經是最新結構，不用再跑 `migrations/`。

### ⚠️ 修正資安問題後，要刪掉舊部署

Cloudflare Pages 會**永久保留每一次部署**，每個部署都有自己的網址（`<編號>.<專案>.pages.dev`），而且全部連著**同一個正式資料庫**。部署新版時，正式網址會改指向新版，但舊網址照樣能開，跑的是當時的舊程式。

所以只要修的是資安問題（例如登入、權限、輸入檢查），部署後一定要刪掉修正前的所有舊部署，否則別人可以透過舊網址繞過修正。其他沒用的舊部署也可以一起刪，留著沒有好處。

- 控制台：**Workers & Pages** → 專案 → **Deployments** → 舊部署右邊 **⋯** → **Delete deployment**
- 指令：

  ```bash
  npx wrangler pages deployment list --project-name <專案名稱>
  npx wrangler pages deployment delete <部署ID> --project-name <專案名稱>
  ```

刪除後無法復原。目前的正式部署不能刪，不用擔心刪錯。

## 參考文件

- D1 指令：<https://developers.cloudflare.com/workers/wrangler/commands/d1/>
- Pages 指令：<https://developers.cloudflare.com/workers/wrangler/commands/pages/>
- Pages 綁定：<https://developers.cloudflare.com/pages/functions/bindings/>
- Workers AI 價格與免費額度：<https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Workers AI JSON 模式：<https://developers.cloudflare.com/workers-ai/features/json-mode/>
- Pages Functions middleware：<https://developers.cloudflare.com/pages/functions/middleware/>
