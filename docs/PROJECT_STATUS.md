# 專案狀態

## 目標
收藏 LINE 群組裡的 IG/FB 美食影片連結，家人共用、可搜尋、一鍵開 Google Maps。
架構：純 HTML/JS PWA + Cloudflare Pages Functions + D1 + Workers AI，登入用自建「家庭密碼」（`functions/_middleware.js`）。

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
3. AI 擷取 — **已實作；單元測試通過，尚未實測擷取品質（需登入 Cloudflare）**
   - `functions/api/extract.js`：POST `{url, caption}`；沒 caption 時只對 IG/FB 網域（`isSocialUrl`）抓 og:title/og:description；用 Workers AI 綁定 `env.AI` 跑 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`（JSON 模式 `response_format: json_schema`），`parseFields` 同時接受物件或 JSON 字串，回傳 `{caption, fields}`
   - 決策（2026-10-08）：使用者不想付費，從 Claude Haiku 4.5（需預付儲值，無免費方案）改為 Workers AI 免費額度（每日 10,000 neurons，一次約 70）；已移除 `@anthropic-ai/sdk`，`docs/setup/anthropic.md` 刪除
   - 前端「✨ AI 自動填入」只填空白欄位，不覆蓋手打內容；422 時游標跳到貼文文字欄
   - `package.json`：只有 devDependency `wrangler`（使用者要求以專案內版本隔離，避免全域安裝或 `npx wrangler@4` 另抓版本）；scripts：`npm test`（`node --test`）、`npm run dev`（`wrangler pages dev`）、`npm run deploy`（`wrangler pages deploy`）
   - 注意：`wrangler login` 憑證在使用者層級（`%APPDATA%\xdg.config\.wrangler`），各專案共用；需分帳號時改用專案 `.env` 的 `CLOUDFLARE_API_TOKEN`（使用者尚未要求）
4. LINE Bot webhook 自動收連結（驗 `x-line-signature`）— 未開始
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
- 登入（2026-10-12 決策：Cloudflare Zero Trust 免費方案要求綁卡，使用者選擇不綁，改自建家庭密碼）：
  - `functions/_middleware.js` 擋所有路徑（含預覽網址），只放行 `/login`、`/login.html`、`/api/login`、`/api/line/webhook`、`/icon.svg`；未登入網頁 302 → `/login`，API 401
  - `functions/api/login.js`：表單 POST 比對 `FAMILY_PASSWORD`（SHA-256 後定時比較），成功發 `foodmap_session` cookie（`<到期ms>.<HMAC>`，30 天，HttpOnly/Secure/SameSite=Lax）；HMAC key = `SESSION_SECRET` + `FAMILY_PASSWORD`，換密碼即全部登出；失敗固定延遲 1 秒
  - 任一 secret 未設 → 全站 503（fail closed）
  - `/api/line/webhook` 不經登入，安全性靠 LINE 簽章
- 測試資料只用虛構內容，不放家人真實資料或 email

## 待決事項
- 使用者需自備：Cloudflare 帳號、LINE Messaging API channel、家人 email 白名單
- 申請與部署步驟見 `docs/setup/`（`cloudflare.md` → `line.md`）；LINE 只需 Channel secret（secret 名稱 `LINE_CHANNEL_SECRET`），不需 access token
- 已部署：Pages 專案名 `foodmap-edl`（`foodmap` 已被占用），正式網址 `https://foodmap-edl.pages.dev`；D1 已建立並套用 schema（使用者 2026-10-12 操作）。部署時尚未有登入功能，網站曾短暫公開（無真實資料）；登入功能合併後需重新部署並設定 `FAMILY_PASSWORD`、`SESSION_SECRET`
- 本機 `npm run dev` 需帳號已註冊 workers.dev 子網域（AI 遠端綁定要求），使用者尚未註冊；`wrangler.toml` 的 `database_id` 使用者已在本機填入，尚未決定是否 commit（目前未 commit）

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

## 下一步
1. 階段 4 LINE Bot webhook：`functions/api/line/webhook.js`，驗 `x-line-signature`、只存 IG/FB 連結（`source='line'`）並背景跑 AI 擷取、處理 `unsend`（需在 `places` 加 LINE message id 欄位）
2. 使用者建好 Cloudflare 帳號並 `npx wrangler login` 後：用幾則真實貼文實測 Workers AI 擷取品質（繁中、店名準確度），不理想再評估換模型
