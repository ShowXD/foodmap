# Cloudflare 設定步驟

美食地圖的網頁、API 和資料庫都放在 Cloudflare。登入用 Cloudflare Access（email 驗證碼或 Google），任何人都能註冊。每個人有自己的清單，共用的清單用群組管理。
兩份設定文件請依這個順序做：**Cloudflare（本文件）→ [LINE](line.md)**。LINE 需要用到這裡部署出來的網址。
「AI 自動填入」用的是 Cloudflare Workers AI 的免費額度，不需要另外申請 AI 帳號或金鑰。

> ℹ️ 第 5 步的 Access 設定完成前，網站會一律回「登入尚未設定」（HTTP 503）。設定沒做完時網站是鎖住的，不會變成公開。

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

## 5. 用 Cloudflare Access 登入，並用群組區分權限

**怎麼運作**
- 登入由 Cloudflare Access 負責。家人可以用 email 收驗證碼，或直接用 Google 帳號登入。
- 程式會驗證 Access 簽發的憑證（JWT），從中取得登入者的 email。
- **只有列在 Access 允許名單裡的家人 email 能登入**，外人在 Access 登入頁就會被擋下，碰不到程式。
- 每個人第一次登入會自動拿到一個「我的清單」，只有自己看得到。
- 全家共用的是「家人」群組：網站管理員建立後，群組擁有者在「成員」頁用 email 把家人加進來。不是群組成員的人，看不到群組裡的任何資料。
- 網站管理員可以在「管理」頁停用任何帳號。

> 共有三層把關：Access 允許名單（外人進不來）→ 程式驗證 Access 憑證（偽造的擋下）→ 清單權限（個人清單只有本人看得到）。
> Access 免費方案最多 50 位使用者，需要先綁定付款方式。

### 5-1 查出你的 team 網域

**Zero Trust** → **Settings** → **Team name and domain**。網域長得像 `xxxx.cloudflareaccess.com`，後面會用到。

### 5-2 開啟登入方式

**Zero Trust** → **Integrations** → **Identity providers** → **Add new identity provider**：

- **One-time PIN**：用 email 收驗證碼登入，選了就完成。
- **Google**（[官方說明](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)）：
  1. 到 [Google Cloud console](https://console.cloud.google.com/) 建立專案。這個專案之後也可以給 Google 地圖用。
  2. **APIs & Services** → **OAuth consent screen**：Audience 選 **External**，填 App 名稱和聯絡 email。
  3. **Create OAuth client** → 類型選 **Web application**：
     - **Authorized JavaScript origins**：`https://<你的team網域>`
     - **Authorized redirect URIs**：`https://<你的team網域>/cdn-cgi/access/callback`
  4. 把 Google 給的 **Client ID** 和 **Client secret** 貼回 Cloudflare 的 Google 設定裡，存檔後按 **Test** 測試。

  > Client secret 只貼在 Cloudflare 控制台，不要寫進 repo。

### 5-3 保護正式網址和預覽網址

網站有兩種網址，**都要保護**：

- 正式網址 `<專案>.pages.dev`：家人平常用的。
- 每次部署產生的版本網址 `<編號>.<專案>.pages.dev`：這些也連著同一個正式資料庫，沒保護的話，別人知道網址就能繞過登入。

做法是**一個 Access 應用程式、兩個目的地**。因為 `*.pages.dev` 不是你帳號裡的網域，要先讓 Pages 幫你建立應用程式（[官方說明](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)）：

1. **Workers & Pages** → 你的專案 → **Settings** → 找到 **Enable access policy** 並開啟。Cloudflare 會建立一個 Access 應用程式，目的地是 `*.<專案>.pages.dev`。
2. 點 **Manage**，到這個應用程式的 **目的地（Destinations）**，按 **新增公開主機名稱**，加第二筆：子網域**留空**，網域選 `<專案>.pages.dev`。
   現在它有兩個目的地，同時保護正式網址和所有版本網址。
3. 名稱改成好認的，例如 `foodmap`。

> 之後 Pages 設定頁的「預覽存取」那一列，**不要再按啟用**，否則會多建一個應用程式。

**原則：建一條可重複使用的「家人名單」原則**

**Access 控制** → **原則** → **建立原則**：

- 名稱：`foodmap 家人`
- 動作：**Allow**
- 原則工作階段持續時間：例如 1 週或 1 個月（見下方「登入要維持多久」）
- 包含（Include）：**電子郵件（Emails）**，填入每位家人登入用的 email。**不要用 Everyone**，否則任何人都能註冊進來。

回到應用程式：

- **原則** 分頁：移除自動建立的「Allow Members - Cloudflare Pages」，改選 **foodmap 家人**。
- **登入方法**：只勾 One-time PIN 和 Google。
- 存檔後，到 **詳細資訊／其他設定** 抄下 **Application Audience (AUD) Tag**。只有這一個，後面 `ACCESS_AUD` 就填它。

之後有新家人要用時，把他的 email 加進「foodmap 家人」原則（只改這一處）；要移除某人時，從原則拿掉，再到 App 的「管理」頁停用他的帳號。

> 再加一層保險：Google Cloud 的 **OAuth 同意畫面**保持在「**測試中（Testing）**」，只把家人的 Gmail 加進「**測試使用者**」。這樣就算 Access 原則哪天設錯，外人的 Google 帳號也會在 Google 那一關被擋下。

**驗證**：沒登入時連正式網址、某個版本網址，甚至隨便編一個不存在的子網域（例如 `abc.<專案>.pages.dev`），都應該被導到 `<team>.cloudflareaccess.com` 登入頁。

**登入要維持多久（Session Duration）**：預設 24 小時，過期就要重新登入。在「foodmap 家人」原則（或應用程式設定）把 **工作階段持續時間** 調長，一般家用設 1 週到 1 個月都合理，最長 1 個月。

- 期限越長越方便，但手機遺失時，撿到的人在期限內都能打開 App。
- 遺失時的處理：**Zero Trust** → **團隊與資源** → **使用者** → 找到那個人 → **撤銷工作階段（Revoke session）**，他所有裝置會立刻登出。必要時再到 App 的「管理」頁停用帳號。
- App 右上角的「登出」會結束 Access 的登入，換帳號時使用。
- iPhone「加到主畫面」的 App 和 Safari 的登入是分開的，兩邊各要登入一次。

### 5-4 讓 LINE webhook 路徑繞過 Access

等設定 LINE Bot 時再做，步驟與驗證方式見 [line.md 第 6 步](line.md#6-讓-webhook-路徑繞過-access)。

> ⚠️ 未驗證：在 pages.dev 上用 UI 建單一路徑的 Bypass 還沒實測過。不行的話，備案是改用自訂網域。

### 5-5 設定程式需要的值

```bash
npx wrangler pages secret put ACCESS_TEAM_DOMAIN   # 例如 xxxx.cloudflareaccess.com
npx wrangler pages secret put ACCESS_AUD           # 應用程式的 AUD Tag（若有多個應用程式，用逗號隔開）
npx wrangler pages secret put ADMIN_EMAILS         # 管理員的 email，多個用逗號隔開
npm run deploy
```

- 這些值會在下次部署後生效。
- `ADMIN_EMAILS` 裡的人第一次登入就自動是網站管理員，可以建立群組、停用帳號。其他人只會有自己的「我的清單」。
- 任何一個值沒設好時，網站會一律回 503，不會變成公開。

### 舊的家庭密碼可以刪掉

```bash
npx wrangler pages secret delete FAMILY_PASSWORD
npx wrangler pages secret delete SESSION_SECRET
```

### LINE 的金鑰

`LINE_CHANNEL_SECRET` 的設定方式見 [line.md](line.md)。

### 本機開發

- 本機沒有 Access，所以改用 `.dev.vars` 模擬登入者。這個檔案在 repo 根目錄，`.gitignore` 已排除：

  ```
  DEV_USER_EMAIL=你的email
  ADMIN_EMAILS=你的email
  ```

  `DEV_USER_EMAIL` **只在 localhost 有效**，就算不小心設到正式環境也不會讓人繞過登入。
- **`npm run dev` 必須先 `npx wrangler login`。** `wrangler.toml` 裡的 AI 綁定一定要連到 Cloudflare。
- 第一次在本機跑時，如果出現 `You need to register a workers.dev subdomain`，就到控制台 **Workers & Pages** 依畫面指示註冊一個 workers.dev 子網域，免費、不用綁卡。
- 本機測試 AI 的用量也算在同一份免費額度裡。

## 6. 驗證

```bash
# 沒登入：會被 Access 導到 <team>.cloudflareaccess.com 登入頁（HTTP 302）
curl -sI https://<專案>.pages.dev/ | head -5
curl -sI https://<專案>.pages.dev/api/places | head -5

# LINE webhook 不需要登入；LINE Bot 完成前會回 405
curl -si -X POST https://<專案>.pages.dev/api/line/webhook | head -5
```

接著照這個順序實測：
1. 用手機開網址，用 email 驗證碼或 Google 登入。如果你的 email 在 `ADMIN_EMAILS` 裡，右上角會有「管理」。
2. 到「管理」頁：
   - 如果有跑過 `0004_lists.sql`，會看到升級時建立的「家人」群組，舊的店家都在裡面，但**這個群組還沒有擁有者**。點「管理成員」，輸入你的 email、勾「設為擁有者」再按加入。
   - 全新安裝的話，直接在「群組」區塊建立「家人」。擁有者 email 留空，就是你自己。
3. 請家人登入一次，讓他們的帳號被建立。然後在主頁切到「家人」，點「成員」，輸入他們的 email 加入。
4. 家人重新整理後，就能在清單選單切換到「家人」。
5. 最後把網頁「加到主畫面」安裝成 App。

### 登入怎麼運作（給之後維護的人）

- `functions/_middleware.js` 會用 `lib/access.js` 驗證 `Cf-Access-Jwt-Assertion`：
  - 檢查 RS256 簽章、`iss` 是 team 網域、`aud` 在 `ACCESS_AUD` 裡、而且沒過期。
  - 公鑰從 `<team>/cdn-cgi/access/certs` 取得，快取 1 小時。遇到沒看過的 kid 會重抓，但最少間隔 60 秒。
  - 任何解析錯誤或抓不到公鑰都會拒絕（401），不會變成 500。
- 驗證通過後，用 `lib/users.js` 建立或讀取 `users` 紀錄。只有狀態是 `approved` 的帳號能使用；被停用（或殘留舊的 `pending` 狀態）的帳號，網頁會被導到 `/pending`，API 回 403。這時只放行 `/pending`、`/pending.js`、`/api/me`、`/icon.svg`。
- **跨站請求防護（CSRF）**：非 GET/HEAD/OPTIONS 的請求，若 `Sec-Fetch-Site` 不是 `same-origin`，或 `Origin` 與網站不同，一律回 403。
- **安全標頭**：所有回應都由 middleware 加上：
  - CSP：`script-src 'self'`、`frame-ancestors 'none'`，所以頁面**不能有內嵌 `<script>` 或 `onclick=`**，程式都要放在獨立的 `.js` 檔。
  - `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`。
  - `/api/*` 另外加上 `Cache-Control: no-store`。
  - 之後接 Google 地圖時，要在 CSP 加上 Google 的網域。
- AI 擷取每人每天上限 30 次，記在 `extract_usage` 表，避免一個帳號用光全家的免費額度。抓貼文時若被轉址到非 IG/FB 網域就不讀，最多只讀 512 KB。
- 店家欄位有長度上限：一般欄位 500 字、備註 2000 字、貼文文字 5000 字、網址 2048 字、搜尋字串 100 字。
- 清單權限在 `lib/lists.js`：
  - 個人清單只有本人能用，**網站管理員也看不到**。
  - 群組清單限群組成員，網站管理員則可以看所有群組。
  - 沒有權限時一律回 404，不透露那個 ID 存不存在。
- 只有 `/api/line/webhook` 完全不經過登入。
- 管理 API `/api/users` 只限網站管理員使用，而且禁止停用或降級自己，避免沒有任何管理員。
- 群組擁有者只能由網站管理員指定或移除。

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
| `0003_users.sql` | 新增 `users` 表（個人帳號） | 還沒有 `users` 表的資料庫 |
| `0004_lists.sql` | 個人清單與群組清單；舊店家搬進「家人」群組；取消審核 | 跑過 0003、還沒有 `lists` 表的資料庫 |
| `0005_extract_usage.sql` | AI 擷取每人每日次數紀錄（上限 30 次） | 還沒有 `extract_usage` 表的資料庫 |
| `0006_line.sql` | LINE Bot：記錄店家來自哪則 LINE 訊息、Bot 加入的群組 | 還沒有 `line_groups` 表的資料庫 |

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
