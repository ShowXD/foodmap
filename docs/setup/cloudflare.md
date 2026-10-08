# Cloudflare 設定步驟

美食地圖的網頁、API 和資料庫都放在 Cloudflare，登入由 Cloudflare Access 負責。
兩份設定文件請依這個順序做：**Cloudflare（本文件）→ [LINE](line.md)**。LINE 需要用到這裡部署出來的網址。
「AI 自動填入」用的是 Cloudflare Workers AI 的免費額度，不需要另外申請 AI 帳號或金鑰。

> ⚠️ **API 本身沒有登入檢查。** 第 6 步的 Access 沒設好之前，知道網址的人都能讀寫你們的清單。請一次做完第 1～6 步，中間不要把網址分享出去。

全部指令都在 repo 根目錄執行。

---

## 1. 建立帳號並登入 wrangler

1. 到 <https://dash.cloudflare.com/sign-up> 註冊（免費方案就夠）。
2. 在終端機登入，瀏覽器會跳出授權頁面：

   ```bash
   npx wrangler login
   ```

## 2. 建立 D1 資料庫

```bash
npx wrangler d1 create foodmap
```

輸出會有一行 `database_id = "xxxxxxxx-..."`。把它貼到 [`wrangler.toml`](../../wrangler.toml)，取代 `REPLACE_WITH_D1_DATABASE_ID`。

> 這個 ID 不是密碼，但也沒必要公開。要不要 commit 隨你；不想公開的話，就只留在本機、不要 commit 這一行。

套用資料表結構到雲端資料庫（記得加 `--remote`，不加會只套到本機）：

```bash
npx wrangler d1 execute foodmap --remote --file=./schema.sql
```

## 3. 建立 Pages 專案並第一次部署

```bash
npm install
npx wrangler pages project create foodmap
npx wrangler pages deploy
```

- `pages deploy` 會依 `wrangler.toml` 的 `pages_build_output_dir` 上傳 `public/`，連同 `functions/` 一起部署。
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

## 5. 設定金鑰（secret）

金鑰只能放在 Cloudflare secret，**絕對不要寫進任何會被 commit 的檔案**。目前只有 LINE 需要：

```bash
npx wrangler pages secret put LINE_CHANNEL_SECRET    # 取得方式見 line.md
```

指令會要你貼上值，輸入時不會顯示在畫面上。設定完再部署一次比較保險：`npx wrangler pages deploy`。

> 本機開發要用金鑰時，放在 repo 根目錄的 `.dev.vars`（`.gitignore` 已排除），格式是 `LINE_CHANNEL_SECRET=...`，一行一個。
> **本機開發（`npx wrangler pages dev`）必須先 `npx wrangler login`。** `wrangler.toml` 裡的 AI 綁定一定要連到 Cloudflare，沒登入時 dev server 會直接啟動失敗，連清單功能都不能用。本機測試 AI 的用量也算在同一份免費額度裡。

## 6. 用 Cloudflare Access 限制只有家人能登入

Access 免費方案最多 50 位使用者（此數字來自第三方整理，Cloudflare 官方方案頁未能確認）。

### 6-1 開啟「一次性密碼（One-time PIN）」登入方式

**Zero Trust** → **Integrations** → **Identity providers** → **Add new identity provider** → **One-time PIN**

家人登入時輸入 email，信箱會收到驗證碼，不需要另外註冊帳號。

### 6-2 保護正式網址

`*.pages.dev` 不是你帳號裡的網域，沒辦法照一般流程直接新增，要用 Cloudflare 文件寫的繞法（[官方說明](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)）：

1. **Workers & Pages** → `foodmap` → **Settings** → 找到 **Enable access policy** 並開啟。
   這時建立的 Access 應用程式只保護預覽網址 `*.foodmap.pages.dev`。
2. 點 **Manage** → **Configure**，在 **Public hostname** 的 **Subdomain** 欄位把 `*` 刪掉後儲存（若報錯，先幫應用程式改個名字再存）。
   這樣它就改成保護正式網址 `foodmap.pages.dev`。
3. 回到 Pages 的 **Settings**，再按一次 **Enable access policy**，重新保護預覽網址。
   最後會有兩個 Access 應用程式，一個管正式網址、一個管預覽網址。

> 預覽網址（每次部署都會產生一個）預設是公開的，所以第 3 步不能省。

### 6-3 設定允許名單

在上面兩個應用程式的 **Policies** 各加一條：

- Action：**Allow**
- Include → **Emails** → 填入家人的 email

沒被列入的人一律擋下（Access 預設拒絕）。家人的 email 只填在 Cloudflare 控制台，不要寫進 repo。

### 6-4 讓 LINE webhook 路徑繞過 Access

LINE 伺服器無法登入，所以 `/api/line/webhook` 要另開一個 Access 應用程式放行。安全性改由程式驗證 LINE 簽章（`x-line-signature`）把關。

1. **Zero Trust** → **Access controls** → **Applications** → **Create new application** → **Self-hosted and private**
2. Public hostname 填 `foodmap.pages.dev`，**Path** 填 `api/line/webhook`
   （如果下拉選單選不到 pages.dev，試試 **Switch to custom input**）
3. Policy：Action 選 **Bypass**，Include → **Everyone**

路徑比較長的規則優先，而且不會繼承上層的允許名單。

> ⚠️ 未驗證：「在 pages.dev 網域上用 UI 建立單一路徑的 Bypass」這一步目前還沒實測過，第四階段 LINE webhook 完成後要測。
> 如果不行，備案是改用自訂網域，或把 webhook 拆成獨立的 Worker。

## 7. 驗證

```bash
# 應該被導到 Cloudflare Access 登入頁（HTTP 302，Location 指向 cloudflareaccess.com）
curl -sI https://foodmap.pages.dev/ | head -5
curl -sI https://foodmap.pages.dev/api/places | head -5

# 第四階段完成後：應該直接打到 Function（回 401 或 405，而不是 302）
curl -si -X POST https://foodmap.pages.dev/api/line/webhook | head -5
```

最後用手機開網址，輸入家人 email 收驗證碼登入，再把網頁「加到主畫面」安裝成 App。

---

## 之後更新程式

```bash
npx wrangler pages deploy
```

資料表結構有變動時，要再對 `--remote` 執行一次對應的 SQL。

## 參考文件

- D1 指令：<https://developers.cloudflare.com/workers/wrangler/commands/d1/>
- Pages 指令：<https://developers.cloudflare.com/workers/wrangler/commands/pages/>
- Pages 綁定：<https://developers.cloudflare.com/pages/functions/bindings/>
- Workers AI 價格與免費額度：<https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Workers AI JSON 模式：<https://developers.cloudflare.com/workers-ai/features/json-mode/>
- One-time PIN：<https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/>
- Access 路徑規則：<https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/>
