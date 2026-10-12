# 專案狀態

## 目標
收藏 LINE 群組裡的 IG/FB 美食影片連結，家人共用、可搜尋、一鍵開 Google Maps。
架構：純 HTML/JS PWA + Cloudflare Pages Functions + D1 + Workers AI，登入用 Cloudflare Access（Email 驗證碼、Google）+ App 內管理員審核（`functions/_middleware.js`）。

## 目前分支
- `main`：已 fast-forward 合併階段 1、2、編輯功能、階段 3 與設定文件，未 push
- 流程約定：每完成一個功能就 commit；分支的功能做完就合回 main；push 需另外指示

## 階段
1. PWA 骨架 + 手動新增 + 搜尋 — **已實作、本機驗證通過**
2. Web Share Target（Android 從 LINE 分享進來）— **已實作、本機驗證通過**，尚未在 Android 實機測
   - manifest `share_target` GET 到 `/`；`app.js` 的 `prefillFromShare()` 從 url/text/title 抓第一個 http(s) 連結填入，其餘文字放貼文欄，`source=share`
   - 注意：hidden input 設值會連預設值一起改，表單 reset 後必須手動設回 `manual`
2.5 編輯店家 — **已實作、本機驗證通過**
   - 卡片「編輯」把資料帶入同一張表單（url 唯讀、hidden `id`），送出改走 PATCH；「取消編輯」還原表單
3. AI 擷取 — **已實作；使用者 2026-10-12 在正式環境實測可成功填入**（發現一則影片可能有多家店 → 已做多店功能）
   - `functions/api/extract.js`：POST `{url, caption}`；沒 caption 時只對 IG/FB 網域（`isSocialUrl`）抓 og:title/og:description；用 Workers AI 綁定 `env.AI` 跑 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（JSON 模式 `response_format: json_schema`），`parseFields` 同時接受物件或 JSON 字串，回傳 `{caption, fields}`
   - 決策（2026-10-08）：使用者不想付費，從 Claude Haiku 4.5（需預付儲值，無免費方案）改為 Workers AI 免費額度（每日 10,000 neurons，一次約 70）；已移除 `@anthropic-ai/sdk`，`docs/setup/anthropic.md` 刪除
   - 前端「✨ AI 自動填入」只填空白欄位，不覆蓋手打內容；422 時游標跳到貼文文字欄
   - `package.json`：只有 devDependency `wrangler`（使用者要求以專案內版本隔離，避免全域安裝或 `npx wrangler@4` 另抓版本）；scripts：`npm test`（`node --test`）、`npm run dev`（`wrangler pages dev`）、`npm run deploy`（`wrangler pages deploy`）
   - 注意：`wrangler login` 憑證在使用者層級（`%APPDATA%\xdg.config\.wrangler`），各專案共用；需分帳號時改用專案 `.env` 的 `CLOUDFLARE_API_TOKEN`（使用者尚未要求）
4. LINE Bot webhook 自動收連結（驗 `x-line-signature`）— 未開始（排在路線圖最後，見下方「已核准的路線圖」）
   - 已查證：LINE Messaging API **沒有**對訊息加表情回應的 API；Bot 將完全靜默（不回覆）
   - 要處理 `unsend` 事件：訊息被收回時刪除對應的已存連結
   - 群組內 Bot 會收到所有訊息，只保存比對到的 IG/FB 連結，其餘不存

## 階段 1 內容
- `schema.sql`：`places` 表（url UNIQUE、status 限 todo/visited）
- `functions/api/places.js`：GET `?q=`（LIKE 搜尋）、POST（url 需 http(s)，重複回 409）、PATCH（`{id, ...欄位}`，欄位白名單）
- `public/`：`index.html`、`app.js`、`style.css`、`manifest.webmanifest`、`sw.js`（network-first，只快取殼，不碰 `/api/`）、`icon.svg`
- `wrangler.toml`：`database_id` 仍是佔位字串，部署前要填

## 驗證結果（2026-10-08）
- `node --test test/places.test.mjs`：3/3 通過
- `npx wrangler@4 pages dev`（D1 local，persist 到 repo 外）：POST 201、重複 409、`javascript:` url 400、搜尋命中/未命中、PATCH 200/404、靜態檔全 200
- Chrome：表單新增 → 列表出現、導航連結正確、console 無錯誤
- 尚未驗證：PWA 安裝

## 資安約束（repo 預計公開）
- 任何金鑰（LINE channel secret 等）只放 Cloudflare secret 或本機 `.dev.vars`，不進 repo（`.gitignore` 已排除 `.dev.vars*`、`.env*`、`.wrangler/`）
- 登入（2026-10-12 最終決策：使用者改為願意綁卡 → 用 Cloudflare Access，登入方式 Email 驗證碼 + Google；App 內管理員審核；取代曾短暫上線的家庭密碼）：
  - Access 政策 Include Everyone（任何登入者），真正授權在 App：`users` 表 status pending/approved/disabled + is_admin
  - `lib/access.js`：用 WebCrypto 驗 `Cf-Access-Jwt-Assertion`（RS256、iss=team 網域、aud ∈ `ACCESS_AUD`、exp/nbf、需有 email），certs 快取 1 小時、未知 kid 重抓一次；未引入 jose 依賴
  - `lib/users.js`：首次登入建 pending；`ADMIN_EMAILS` 內的 email 自動成為已核准管理員（不用「第一個登入者當管理員」，避免陌生人搶先）
  - `functions/_middleware.js`：只放行 `/api/line/webhook`；缺 `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` → 503（fail closed）；JWT 無效 → 401；非 approved → 網頁 302 `/pending`、API 403（只放行 `/pending`、`/api/me`、`/icon.svg`）；`DEV_USER_EMAIL` 只在 localhost 生效
  - `functions/api/me.js`（目前登入者）、`functions/api/users.js`（管理員限定 GET/PATCH，禁止停用或降級自己）；`public/pending.html`、`public/admin.html`；主頁右上顯示 email、管理、登出（`/cdn-cgi/access/logout`）
  - 部署需設 secret：`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`（正式,預覽 兩個 AUD）、`ADMIN_EMAILS`；可刪除舊的 `FAMILY_PASSWORD`、`SESSION_SECRET`
  - `/api/line/webhook` 需在 Access 另建 Bypass app（pages.dev 上可行性未實測），安全性靠 LINE 簽章
- 測試資料只用虛構內容，不放家人真實資料或 email

## 待決事項
- 使用者需自備：Cloudflare 帳號、LINE Messaging API channel、家人 email 白名單
- 申請與部署步驟見 `docs/setup/`（`cloudflare.md` → `line.md`）；LINE 只需 Channel secret（secret 名稱 `LINE_CHANNEL_SECRET`），不需 access token
- 已部署：Pages 專案名 `foodmap-edl`（`foodmap` 已被占用），正式網址 `https://foodmap-edl.pages.dev`；D1 已建立並套用 schema（使用者 2026-10-12 操作）
- 線上目前跑的是家庭密碼版（2026-10-12 已驗證未登入 302/401）；Access 版合併後需使用者依 `docs/setup/cloudflare.md` 第 5 步設定 Access 與 secret、跑 `migrations/0003_users.sql` 再部署，並刪除家庭密碼版的舊部署
- 資安事件（已處理）：無登入的舊部署 `b313a776.foodmap-edl.pages.dev` 仍可免登入讀寫正式 D1（Pages 永久保留每次部署）；使用者已刪除，驗證回 404；當時 DB 無資料。規則：資安修正部署後必須刪除修正前的舊部署（寫在 `docs/setup/cloudflare.md`）
- 本機 `npm run dev` 需帳號已註冊 workers.dev 子網域（AI 遠端綁定要求），使用者尚未註冊；`database_id` 已依使用者同意 commit（0314e73）

## 階段 2 驗證（2026-10-08）
- 本機 `wrangler pages dev` + Chrome：`/?text=這家好好吃 <IG連結>&url=<IG連結>` → 表單自動展開、連結與貼文文字正確帶入、網址列清掉 query；存檔後 DB `source=share`，表單 `source` 回到 `manual`；console 無錯誤
- 本機 dev 注意：背景停止 wrangler 時 `workerd.exe` 可能殘留佔住 port 8788 且無回應，需手動結束
- 本機 dev 注意：`wrangler.toml` 有 `[ai]` 綁定後，未 `wrangler login` 時 `wrangler pages dev` 會啟動失敗（"Failed to start the remote proxy session"，非互動環境需 `CLOUDFLARE_API_TOKEN`）；Pages 以 wrangler.toml 為設定來源，綁定不能只放控制台

## 編輯功能驗證（2026-10-08）
- 本機 `wrangler pages dev` + Chrome：按編輯 → 表單帶入既有資料、url 唯讀、按鈕變「更新」；改店名與地址送出 → DB 更新、url/source 不變、表單回到新增模式；取消編輯 → 表單清空並收合；console 無錯誤

## 階段 3 驗證（2026-10-08）
- `npm test`：9/9 通過（`test/extract.test.mjs`：網域白名單、og 解析與 HTML entity、`parseFields`、缺 AI 綁定 503、抓不到文字 422、AI 成功 200／AI 拋錯 502，AI 以假物件替代）
- 先前 Anthropic 版本曾在本機 wrangler + Chrome 驗證過抓不到文字 422、超長 413 與前端訊息；換成 Workers AI 後這些路徑程式未變
- 尚未驗證：Workers AI 實際擷取繁體中文的品質（`wrangler pages dev --ai AI` 需登入 Cloudflare，本機目前未登入）、真實 IG/FB 貼文能否抓到 og 文字

## 已定案的使用者決策
- LINE Bot 完全不回話（LINE 無表情回應 API，回貼圖會變成群組訊息）
- 家人會事先被告知群組有 Bot
- 要有 Cloudflare、Anthropic、LINE 三份申請步驟文件（`docs/setup/`）

## 多店功能（2026-10-12，已實作、本機驗證通過）
- 一則影片可存多家店：`places.url` 拿掉 UNIQUE（改一般索引 `places_url`）；重複判定改為「同 url 且同店名」（`COALESCE(name,'')`）
- 既有資料庫升級：`migrations/0002_multi_place.sql`（重建表、保留資料），**部署前要對 remote 執行一次**；`schema.sql` 已是新結構
- `/api/extract` 回傳改為 `{caption, places: [...]}`（`parsePlaces`，最多 10 家，丟掉全空的項目，也接受模型只回單一物件）
- 前端：AI 找到 1 家（或編輯中）→ 只填空白欄位；多家 → 候選清單（預設全勾）→「儲存勾選的店家」逐筆 POST，回報已存／重複／失敗數
- 驗證：`npm test` 13/13；scratch 本機 D1 先建舊 schema + 資料 → 遷移前同 url 第二家被 UNIQUE 擋、遷移後可存且原資料與 status 保留；Chrome（以假 `/api/extract` 回應）測多店勾選儲存、重複判定、單店只填空白欄位
- 未驗證：正式環境 Workers AI 對多店貼文的實際擷取品質

## 已核准的路線圖（2026-10-12，依序，每項一個分支）
1. ✅ 多店（本節上方）
2. ✅ 個人帳號（改用 Cloudflare Access + App 內審核，見「資安約束」；原本規劃的 LINE Login / 自建帳密已取消）
   - 驗證（2026-10-12）：`npm test` 16/16（`test/access.test.mjs`：JWT 正確／錯 aud／錯 iss／過期／nbf／缺 email／竄改／alg none／未知 kid／金鑰輪替重抓；ensureUser；middleware fail-closed、DEV_USER_EMAIL 非 localhost 無效、pending 導向）；scratch 本機 wrangler（無 AI 綁定）以 `DEV_USER_EMAIL` 模擬：pending 家人網頁 302 `/pending`、API 403、`/api/me` 200；管理員在 `/admin` 核准（Chrome）後家人可用 `/api/places`、`/api/users` 仍 403；管理員停用／降級自己被擋
   - 未驗證：真實 Access JWT（需使用者設定 Access 後部署）
3. ~~個人化（共用清單 + 個人紀錄）~~ → 2026-10-12 改為下方「權限模型 v2」

## 權限模型 v2（2026-10-12 使用者決策，取代「管理員審核」）
> **2026-10-12 後續決策：只有自家人使用，取消自訂身分組（第 2 階段）。** 資安改在入口把關：兩個 Access 應用程式原則改為 **Include Emails（家人 email 白名單）**，不用 Everyone；Google OAuth 同意畫面保持「測試中」、只加家人為測試使用者。程式維持第 1 階段（個人清單 + 家人群組）當第二道防線。下方「一律可註冊」一項以此為準。
- **一律可註冊**（程式層不再審核；實際入口由 Access email 白名單限制；網站管理員可停用帳號）
- 每人自動有「個人清單」（只有自己看得到）；新註冊者預設只有個人清單，碰不到任何群組資料
- **群組**：各自獨立的店家清單（如「家人」「同事」），一人可加入多群組，畫面可切換清單；現有店家搬進「家人」群組
- **只有網站管理員（`ADMIN_EMAILS`）能建立群組**並指定擁有者；網站管理員可存取所有清單
- **加入群組用 email**（對方需已登入過一次），由有「管理成員」權限者操作
- **自訂身分組（類 Discord，每個群組各自定義）**，可勾選權限：看清單、新增店家、編輯自己新增的、編輯所有人的、刪除、管理成員、管理身分組；群組擁有者永遠全權限
- 併入：記錄 `created_by`、「吃過了」改每人各自標記
- 分階段：
  1. ✅ 清單架構（2026-10-12 實作並本機驗證）：`lists`／`list_members`、`places.list_id`/`created_by`、個人清單自動建立、清單切換、管理員建群組與 email 加成員、搬移現有資料、拿掉審核（此階段群組成員權限一律全開）
     - 程式：`lib/lists.js`（`findAccessibleList`、`findManageableGroup`、`accessibleLists`、`ensurePersonalList`）；`functions/api/lists.js`（GET 清單、POST 建群組限網站管理員）；`functions/api/list-members.js`（GET 成員、POST 以 email 加入、DELETE 移除；擁有者只能由網站管理員指定或移除）；`places.js` 所有操作限可存取清單、POST 記 `created_by`、重複判定改為同清單內；無權限一律 404
     - 個人清單網站管理員也看不到；網站管理員可存取所有群組
     - 前端：主頁清單選單（記住上次選擇）＋「成員」連結；`public/members.html`；`public/admin.html` 改為群組建立＋帳號停用；`pending.html` 只剩停用提示
     - 升級：`migrations/0004_lists.sql` 建「家人」群組（**無擁有者**，需網站管理員在成員頁加自己並勾「設為擁有者」）
     - 驗證：`npm test` 23/23（新增 `test/d1.mjs` 以 node:sqlite 跑真實 schema；`test/lists.test.mjs` 6 項權限情境）；scratch 本機 D1 從最早 schema 依序跑 0002→0003→0004，舊資料與 status 進「家人」；本機 wrangler 三身分實測（家人加入前 404、管理員 Chrome 指定擁有者與加成員、主頁切換清單、家人加入後可讀寫家人清單但讀不到管理員個人清單、不能管理成員／建群組／用 /api/users）
  2. ~~自訂身分組與權限檢查~~（已取消：只有自家人使用）
  3. 每人各自「吃過了」（未定，等使用者需要再做）
  4. 之後：Google 地圖、LINE Bot（LINE 群組對應到美食地圖群組）
4. Google 地圖：開 App 即為地圖、顯示已存店家標點與使用者目前位置；**使用者同意綁卡**使用 Google Maps Platform（Maps JS + Geocoding，需 Google Cloud 專案與帳單帳戶；Google 登入可用同一專案）
5. LINE Bot webhook：`functions/api/line/webhook.js`，驗 `x-line-signature`、只存 IG/FB 連結（`source='line'`）、AI 擷取可多店、處理 `unsend`（需記 LINE message id）

## 資安檢查與修正（2026-10-12）
- 由資安檢查 agent 唯讀審查全專案：無 Critical/High。已修（分支 `fix/security-hardening`）：
  - M1 CSRF：middleware 擋非安全方法的跨站請求（`Sec-Fetch-Site`≠same-origin 或 `Origin` 不符 → 403）
  - M2 安全標頭：middleware 對所有回應加 CSP（`script-src 'self'`、`frame-ancestors 'none'` 等）、XFO DENY、nosniff、Referrer-Policy；`pending/admin/members` 內嵌 script 移到 `public/*.js`
  - M3 AI 濫用：`extract_usage` 表，每人每日 30 次（`migrations/0005_extract_usage.sql`）
  - L1 擷取轉址後再驗網域、最多讀 512 KB；L2 JWT 解析錯誤／certs 失敗回 null（401）；L3 強制重抓 certs 最少間隔 60 秒；L4 middleware 改為只放行 `approved`、`/api/users` 不能設 pending；L6 欄位／網址／搜尋長度上限；L7 `/api/*` 加 `Cache-Control: no-store`
  - 未修：L5（群組擁有者可試探 email 是否註冊，一家人使用可忽略）；作者 email 在 commit 中——使用者選擇維持（已公開於 GitHub）
- 驗證：`npm test` 27/27；scratch 本機 wrangler 確認回應帶 CSP/XFO/nosniff、`/api/*` no-store、跨站 POST 403、同站 POST 201；Chrome 在 CSP 下主頁新增店家、管理頁、成員頁皆正常，嵌入 iframe 被 frame-ancestors 擋下
- Access 登入有效期預設 24 小時，文件已說明可調至最長 1 個月與遺失手機時撤銷工作階段

## 下一步
1. 使用者（進行中）：Access 已合併為**單一應用程式、兩個目的地**（`foodmap-edl.pages.dev` 與 `*.foodmap-edl.pages.dev`），共用原則「foodmap 家人」（Include Emails，目前只有使用者本人，家人 email 之後再加）；2026-10-12 驗證正式網址、版本網址 c62d6197、不存在的子網域皆 302 → blue-mouse-e3db.cloudflareaccess.com；`ACCESS_AUD` 已設定。待確認：`ACCESS_TEAM_DOMAIN`、`ADMIN_EMAILS` 是否已設；remote 依序跑 0002（若尚未）、0003、0004、0005；`npm run deploy`；刪除舊部署
2. 部署後：管理員到成員頁把自己設為「家人」擁有者、加入家人
3. 路線圖：Google 地圖、LINE Bot
