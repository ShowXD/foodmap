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
  - 部署需設 secret：`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`（單一應用程式的 AUD；程式也接受逗號分隔的多個）、`ADMIN_EMAILS`；可刪除舊的 `FAMILY_PASSWORD`、`SESSION_SECRET`
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

## LINE Bot（2026-10-12，已實作、本機驗證；尚未在 LINE 實際串接）
- `functions/api/line/webhook.js`：驗 `x-line-signature`（HMAC-SHA256，`LINE_CHANNEL_SECRET`，無 secret → 503、簽章錯 → 401）；回 200 後在 `waitUntil` 依序處理事件；完全不回話
  - `join`／群組訊息會記錄到 `line_groups`；**只有網站管理員綁定到群組清單的 LINE 群組才收連結**（外人把 Bot 拉進別的群組無效）；1:1 聊天忽略
  - 每則訊息最多 3 個 IG/FB 連結（`parseLinks`，用 `isSocialUrl`），同則訊息其餘文字當 caption，無文字才嘗試抓 og；AI（`extractPlaces`，與表單共用）每家店一筆，`source='line'`、`line_message_id`；AI 失敗／額度用完／找不到店也存一筆只有連結的紀錄
  - 重送去重（同 message id + url 跳過）；同清單同 url 同店名不重複
  - `unsend` 刪除該訊息存下的店家
  - LINE 自動分析每日上限 50（以當日 `source='line'` 的不同訊息連結數計），超過只存連結
- `functions/api/line-groups.js`：網站管理員限定 GET／PATCH 綁定（只能綁群組清單，不能綁個人清單）；`public/admin.html`/`admin.js` 新增「LINE 群組」區塊
- `extract.js` 抽出 `extractPlaces`、匯出 `fetchCaption` 供 webhook 共用
- 升級：`migrations/0006_line.sql`（`places.line_message_id`、`line_groups`）
- 驗證：`npm test` 34/34（`test/line.test.mjs` 7 項：簽章、連結解析、未綁定不存、多店存入與重送去重、AI 失敗存連結、收回刪除與忽略 1:1／非社群連結、綁定 API 權限）；scratch 本機 wrangler 實送簽章 webhook：偽造 401、空事件 200、未綁定只記錄群組、管理 API 綁定後存入家人清單（本機無 AI → 只存連結＋訊息文字）、unsend 刪除；Chrome 管理頁綁定／解除綁定正常
- 未驗證：pages.dev 上 webhook 路徑的 Access Bypass app、LINE Verify、正式環境 AI 對群組貼文的擷取品質
- 設定步驟見 `docs/setup/line.md`

## Service Worker 不再快取（2026-10-13）
- 問題：使用者手機上仍出現已移除的家庭密碼登入頁且無法登入。原因推斷：家庭密碼時期 SW 安裝時 `cache.addAll(['/', …])` 被轉址到 `/login`，把登入頁存成 `/`；改用 Access 後，未登入的導覽被轉到 cloudflareaccess.com，手機（尤其 iOS 主畫面 App）上 fetch 失敗時 SW 用快取回應 → 顯示舊登入頁；且舊 SW 要登入成功後才能更新
- 修正（f0f7fad）：`public/sw.js` 只保留可安裝 PWA，不快取、無 fetch handler，啟用時刪除所有快取
- 驗證：Chrome 全新環境先放入模擬舊快取 `foodmap-shell-v1`，載入首頁後新 SW 啟用並清空快取、頁面正常
- 已受影響的手機需手動清除網站資料或移除主畫面 App 後重新安裝（新 SW 要等能載入網站後才會接手）
- LINE：使用者已完成 webhook Bypass app，LINE Verify 回 Success（先前 401 為 Cloudflare 與 LINE 的 channel secret 不一致，重設並重新部署後解決）

## v2 計畫（2026-10-13 使用者核准）：地圖優先、底部導覽列、單手操作
- 導覽列四頁：地圖 / 清單 / ＋ / 我的（hash 路由 `#map` `#list` `#add` `#me`）
- 階段 A（不需 Google，進行中，分支 `feature/v2-nav-personal`）：導覽列骨架；每人各自「吃過」＋評分心得（`place_visits`）；想吃星號（`place_stars`）；最近新增「新」（`list_reads`）；待整理區（沒店名／之後沒座標）；篩選 chips（未吃／吃過／★／標籤）；分享單一店家（Web Share）；匯出 CSV；`migrations/0007_personal.sql`
- 階段 B（需使用者建 Google Cloud 專案與金鑰）：Google 地圖、我的位置、標點卡片、附近＋距離、今天吃什麼、拖曳修正位置；Places Text Search 取座標；CSP 加 Google 網域；Maps 金鑰由 `/api/config` 提供、Places 金鑰為 secret
- 階段 C：營業時間／Google 評分（Place Details，7 天快取）、影片縮圖（og:image 存 R2）
- 已查證（2026-10-13，詳見 `docs/setup/google.md`）：Dynamic Maps 10k/月免費；Text Search（id/displayName/formattedAddress/location）= Text Search Pro 5k/月；Place Details 只要 location = Essentials 10k/月；opening hours/rating = Place Details Enterprise **1k/月**。**條款：place ID 可永久存、lat/lng 最多快取 30 天（Service Terms 14.3）、其他 Places 內容不可存**；Places 資料須顯示於 Google 地圖或附 Google 標示；需有使用條款／隱私權頁。CSP 官方 allowlist：script-src 加 `'unsafe-eval' https://*.googleapis.com https://*.gstatic.com *.google.com https://*.ggpht.com *.googleusercontent.com blob:`、img-src/connect-src 加 googleapis/gstatic/google.com、`frame-src *.google.com`、`font-src https://fonts.gstatic.com`、`worker-src blob:`（官方範例含 script `'unsafe-inline'`，本專案無內嵌 script，實作時驗證可否省略）
- **設計調整（因條款）**：存 `google_place_id`（永久）＋ `lat/lng/location_fetched_at`（>25 天在背景用 Place Details Essentials 重抓）；手動拖曳位置 `location_source='manual'` 永久保存；營業時間／評分不存，開卡片時即時查詢並設每日上限；Google 的店名／地址不覆寫使用者／AI 內容；Advanced Markers 需 Map ID
- secret：`GOOGLE_MAPS_BROWSER_KEY`、`GOOGLE_MAPS_MAP_ID`（經 `/api/config` 給已登入前端）、`GOOGLE_PLACES_KEY`（只在伺服器）
- 待查證：R2 綁定（階段 C 縮圖）、只貼連結時的抓取成功率（待使用者給真實連結）
- 完整計畫：見 Claude 計畫檔（摘要即本節）
- **階段 A ✅（2026-10-13 完成並本機驗證）**
  - 後端：`schema.sql` 加 `place_visits`/`place_stars`/`list_reads`、`migrations/0007_personal.sql`（舊 `status='visited'` 且有 `created_by` 轉入 visits）、`lib/lists.js` 加 `findAccessiblePlace`、新 API `functions/api/visits.js`（GET ?place= 全家評價／PUT 吃過＋評分心得／DELETE）、`stars.js`、`list-read.js`、`export.js`（CSV，BOM，防公式注入）；`places.js` GET 帶回 `my_visited_at/my_rating/my_note/visit_count/avg_rating/starred/is_new`（「新」＝別人在我上次開清單後新增）
  - 前端：`index.html` 四個 view（hash 路由 `#map/#list/#add/#me`）＋底部固定導覽列（＋ 置中）；地圖頁暫為「即將推出」＋「今天吃什麼」（從我未吃過的店隨機抽）；清單頁篩選 chips（全部／未吃／吃過／★／待整理 N／#標籤）；卡片含星號、新標記、家人摘要、吃過（評分 1–5＋心得 dialog，可看家人評價）、分享（Web Share／複製）、編輯（跳 #add）；「我的」頁含清單切換、成員、匯出 CSV、網站管理、登出。舊的 `places.status` 不再使用
  - 驗證：`npm test` 39/39（`test/personal.test.mjs` 5 項）；本機 wrangler＋Chrome 390×844 手機模擬：導覽列、切換清單、星號、吃過評分（顯示家人評價、更新為 2 人吃過平均 4.5）、四種篩選與標籤、編輯跳轉與取消、今天吃什麼、匯出 CSV 200，console 無錯誤／無 CSP 違規
  - 部署前需對 remote 跑 `migrations/0007_personal.sql`
- **階段 B ✅（2026-10-13 實作並本機驗證；分支 `feature/google-map`；尚未部署、尚未用真實金鑰實測）**
  - 使用者已完成 Google Cloud 設定（配額：SearchText 每日 100／每分 10、GetPlace 每日 30／每分 10；預算警示），三個 secret 已存進 Cloudflare production
  - 後端：`migrations/0008_location.sql`＋`schema.sql`（`places` 加 `google_place_id`、`lat`、`lng`、`location_source` google|manual、`location_fetched_at`）；`lib/google.js`（Text Search 欄位遮罩 `places.id,displayName,formattedAddress,location`＝Pro；Details 只取 `location`＝Essentials；`saveLocation`／`clearLocation`；`expireGoogleLocations` 把超過 30 天的 Google 座標清空；`refreshStaleLocations` 每次開清單最多重抓 5 筆超過 25 天的，Google 回 404 就清回待整理；`isSameShop` 名稱互含判斷）；新 API `config.js`（GET 給前端 Maps 金鑰與 Map ID）、`place-search.js`（POST 最多 3 個候選，不存任何 Google 內容；429→「今天的 Google 查詢次數已用完」）、`place-location.js`（PUT 有 google_place_id＝Google 來源會過期、沒有＝手動永久；DELETE 清除）；`places.js` GET 先清過期座標再查、背景重抓；LINE webhook 存店後若 Google 第一名名稱相符就自動定位，不確定的留在待整理
  - ponytail：沒有 cron，座標只在有人開清單時才過期清除／重抓（30 天內沒人開時資料庫仍留著舊座標，但不會被提供）
  - CSP（middleware）：依官方 allowlist 加 Google 網域與 `'unsafe-eval'`，**不加** script `'unsafe-inline'`；`worker-src 'self' blob:`（只寫 blob: 會擋掉自己的 sw.js，本機驗證時發現）
  - 前端：地圖頁滿版 Google 地圖（第一次打開地圖頁才建立，省地圖載入次數；`gestureHandling: greedy` 單指拖曳）；標點顏色：橘＝未吃、灰＝我吃過、金＝想吃；點標點跳出底部卡片；藍點＝我的位置（啟動即 `watchPosition`，清單頁也有距離）；地圖上方與清單共用篩選 chips，有定位時多「📍 附近」（依距離排序）；待整理＝沒店名或沒座標；卡片「📍 定位」開對話框搜尋 Google 候選（標示「搜尋結果由 Google 地圖提供」），或「自己在地圖上放」；已定位的店「修正位置」可拖曳或點地圖移動標點；今天吃什麼優先抽 5 公里內、符合篩選、我未吃過的店並移動地圖打開卡片；導航連結帶 `query_place_id`；金鑰錯誤（`gm_authFailure`）或未設定時顯示文字提示，清單功能照常
  - 注意：Google 會在地圖元素本身加 `position: relative`，所以滿版定位放在外層 `.map-frame`
  - 驗證：`npm test` 46/46（新 `test/google.test.mjs` 7 項：欄位遮罩、名稱比對、權限 404／未設定 503／配額 429、手動 vs Google 來源、30 天過期不提供、重抓與 404 清除、LINE 自動定位只採名稱相符者）；本機 wrangler（假金鑰）＋Chrome 390×844：無 CSP 違規、地圖區域填滿頂列與導覽列之間、chips 與附近、距離、定位對話框（假金鑰顯示失敗訊息）、從清單「自己在地圖上放」→ 地圖 → 儲存為 manual 並開卡片、今天吃什麼選最近的、卡片不溢出。**未驗證**：真實 Google 地圖畫面、標點點擊、拖曳、Text Search 真實結果（需正式金鑰，限定網域）
  - 未做：Places API 政策要求的使用條款／隱私權頁面（階段 C 前補）

## 切換動畫（2026-10-13，已本機驗證）
- `public/app.js` `showView`：用 View Transitions API（`document.startViewTransition`），往右邊的分頁滑向左、往左邊的滑向右；頂列與導覽列有自己的 `view-transition-name` 所以不跟著滑；第一次顯示（例如分享直接開 `#add`）不動畫；不支援的瀏覽器或系統設定「減少動態效果」時直接切換
- `public/style.css`：`::view-transition-old/new(page)` 滑動 220ms；地圖卡片由下滑入、dialog 輕微放大淡入（皆在 `prefers-reduced-motion: no-preference` 內）
- 驗證：Chrome 手機模擬確認前進／返回兩方向動畫名稱正確，暫停在動畫中途截圖確認地圖（fixed 元素）跟著 main 一起滑入

## 五顆導覽列、地圖按鈕、拿掉頂列（2026-10-13，已本機驗證）
- 導覽列：地圖／清單／＋（置中）／🎲 吃什麼／我的（`VIEWS` 順序同，切換動畫方向依此）；頂部「我的清單」頂列移除，內容從狀態列下方開始（`env(safe-area-inset-top)`）；目前清單只在「我的」頁切換
- 地圖右下 Google 風格圓鈕：「顯示全部店家」（依目前篩選 fitBounds）、「回到我的位置」（一直顯示；沒權限時提示到設定開啟）；原地圖上的今天吃什麼按鈕移到獨立分頁
- 今天吃什麼頁（`#random`）：距離 1／3／5／10 公里／不限、標籤、可勾「也抽我吃過的店」；結果顯示完整卡片＋「在地圖上看」；沒有定位時忽略距離並提示
- 狀態列顏色：`theme-color` 改為依深淺色模式與 App 背景同色（原本橘色）；manifest `theme_color` 同步
- 驗證：Chrome 390×844：五顆按鈕中心 39/117/195/273/351（左右對稱）、隨機頁距離與標籤篩選、在地圖上看開卡片

## 開放給朋友使用（2026-10-13 使用者核准計畫；程式已完成並本機驗證，尚未部署）
- **4. 文件與隱私權頁 ✅**：`docs/setup/cloudflare.md` 新增「開放給朋友」：Access 原則加 Include「登入方法 = Google」（保留 email 那條給驗證碼登入的家人）、**OAuth 同意畫面要從「測試中」改「正式版」**（否則非測試使用者的 Google 帳號會被擋）、Zero Trust 免費 50 人上限、陌生人可在帳號管理停用；選填 secret `LINE_BOT_ID`（加好友連結）；migration 表加 0012。新增 `public/privacy.html`（`/privacy`，「我的」頁有連結）：存了什麼、誰看得到、第三方服務（含 Google 地圖條款連結、座標 30 天規定）、刪除方式
- **用地址修正位置（2026-10-14，已本機驗證）**：卡片「修正位置」改為開啟定位對話框（不再直接進入拖曳）：標題「修正「店名」的位置」、預填店家地址（沒有就空白）、游標在輸入框、**不自動搜尋**（不消耗地點搜尋次數），輸入完整地址或店名按搜尋，從 Google 候選中選；「改用地圖拖曳圖釘」保留為備用。第一次定位仍會自動以店名搜尋。驗證：本機開啟時 `/api/place-search` 0 次、按搜尋才 1 次
- **開啟時聚焦自己＋圖釘樣式（2026-10-14，已本機驗證）**：地圖第一次拿到定位就置中自己（zoom 15），不再縮放到全部店家；定位被拒或不支援時才退回顯示全部（fitBounds 移到建立 marker 之前）。「我的」新增圖釘設定（存 localStorage `foodmap.pinStyle`）：形狀（圖釘／圓點／美食圖示 🍜）、大小（小／中／大）、圖釘上方顯示店名；顏色仍代表狀態。驗證：模擬定位 → setCenter＋setZoom 無 fitBounds；模擬拒絕定位 → fitBounds；三種樣式以 CSS 截圖確認；`npm test` 72/72。Google 的 `PinElement` 外觀需真實金鑰才看得到（假金鑰無法驗證）
- **距離篩選畫出範圍（2026-10-14，已本機驗證篩選；圓圈需真實金鑰才看得到）**：「📍 附近」改為「📍 1／3／5 公里」三個篩選（`filter.mode='near'`＋`filter.radius`），只留範圍內的店並依距離排序；地圖以自己的位置為圓心畫出半徑圓（`google.maps.Circle`，不可點），按下篩選時地圖縮放到整個圓，位置更新時圓心跟著移動，換其他篩選就移除。驗證：本機模擬定位，1／3／5 公里分別顯示 2／2／3 家、回「全部」3 家；`npm test` 72/72
- **定位準確度（2026-10-14，未在真機驗證）**：使用者回報定位與實際位置差很多。改為：`watchPosition` 的 `maximumAge` 0（不用快取的粗略位置）；我的位置外圍畫出瀏覽器回報的誤差範圍（淡藍圓）；之後拿到誤差小一半以上的位置，且地圖沒被移動過時自動重新置中；我的位置藍點錨點修正到圓心（原本偏上 9px）；按「回到我的位置」時誤差 >500 公尺會提示開啟 Android「使用精確位置」。最可能原因是 Chrome 只拿到「大概位置」權限。`npm test` 72/72；假金鑰無法畫圓，需部署後實機確認
- **AI 重新分析（2026-10-14，已本機驗證）**：起因是家人群組一天傳了 47 個連結，超過 LINE 每群組每日 20 次 AI，之後的連結只存網址與貼文文字（店名空白）。卡片在「沒有店名但有貼文文字」時顯示「✨ AI 重新分析」：用已存的貼文文字呼叫 `/api/extract`（算按的人每日 30 次），只補空白欄位（PATCH），同一貼文的其他店另外新增（同網址不同店名，409 略過）。只改前端（`app.js`、`index.html` 樣板）。不會自動定位，分析完照常按「📍 定位」。驗證：本機模擬 AI 回傳兩家 → 原筆補上店名／地址／菜色、另新增第二家；有店名的卡片不顯示按鈕；`npm test` 72/72
- **AI 亂碼防護＋自動補分析（2026-10-14，`npm test` 74/74；未在正式環境驗證）**：
  - 亂碼：使用者重新分析江家餛飩得到「江家予龍」「號中市西園区」等亂碼。用同一則貼文實測 llama-3.3-70b 9 次都正確，屬偶發。對策：`extractPlaces` 設 `temperature: 0`；新增 `groundPlaces`，店名／地區／地址的每個中文字都要出現在原貼文（臺＝台，市縣區鄉鎮可額外補），菜色與標籤逐項過濾，不合就清空（AI 自創的標籤如「平價」也會被濾掉）。兩個呼叫端（`/api/extract`、LINE）都套用
  - 自動補分析：`migrations/0015_ai_pending.sql`（`places.ai_pending`，並把既有「LINE、無店名、有貼文文字」標為 1）。LINE 超過每群組 20 次或 Cloudflare 額度用完時存成 `ai_pending=1`；有人開啟該清單（`/api/places` GET）時背景 `retryPendingAi` 每次最多補 5 筆，條件是今天（UTC）全站 AI 次數 < 100（保留 40 次給手動），先把旗標清掉再處理避免重複；只在店名仍空白時填入（手動編輯過就不動，PATCH 也會清旗標），同貼文其他店另存，並照常自動定位
  - **上線前要在 remote 跑 0015**（指令在 migration 檔與 `cloudflare.md`）
- **隱私權頁公開（2026-10-14）**：Google OAuth 同意畫面發布前要求首頁、隱私權政策、服務條款網址，且隱私權頁要未登入也看得到 → middleware `PUBLIC_PATHS` 加 `/privacy`、`/privacy.html`；`privacy.html` 改為內嵌樣式、不再載入 `style.css`／`icon.svg`（不需公開其他檔案），`style.css` 移除 `.legal`。Cloudflare 需另建路徑 `privacy` 的 Bypass 應用程式（文件 `cloudflare.md`「完全開放」第 2 步）。驗證：`npm test` 72/72（access 測試：`/privacy` 不需登入、`/privacy-and-more` 與 `/style.css` 仍需登入）
- **登入完全開放（2026-10-14 使用者決定）**：Cloudflare Access 原則 Include 改為 **Everyone**，不再逐一放行；新帳號登入即可用（只看得到自己的清單、受每人每日上限），網站管理員在「帳號管理」事後停用。使用者選擇「直接可用、事後停用」而非「新帳號待審核」，所以程式不用改（現行行為即是）。文件：`docs/setup/cloudflare.md`「完全開放」。待使用者在 Cloudflare 改原則、OAuth 同意畫面改正式版
- **群組邀請連結（2026-10-14，已本機驗證）**：`migrations/0014_invites.sql`＋`schema.sql`（`group_invites(id, code_hash UNIQUE, list_id, created_by, created_at, expires_at)`）；`/api/invites`（GET 列出未用未過期、POST 產生、DELETE 作廢；只限擁有者／網站管理員，個人清單不可；每群組最多 20 條未用）；`/api/join` POST {code}（64 hex，存 SHA-256；已是成員不消耗；先 `DELETE … RETURNING` 搶下確保單次使用；過期／用過 410）；`lib/links.js` 匯出 `randomToken`、`hashToken` 共用。連結格式 `/?join=CODE`（放 query 而非 #，避免登入轉址遺失——正式環境經 Access 登入後是否保留 query **未驗證**）。前端：群組成員頁（擁有者）「🔗 邀請連結」產生／分享（Web Share，否則複製）／複製／列出未用與作廢；App 啟動時處理 `?join=`：清掉網址參數、加入、重新載入清單、切到該群組並提示。驗證：`npm test` 72/72（新 `test/invites.test.mjs` 3 項）；本機擁有者產生 → 新帳號開連結 →「已加入「家人」！」並切到家人清單
- 正式環境查證（2026-10-14）：remote 已有 0009～0013 的所有表；production 部署為 `0abbb08`
- **YouTube Shorts（2026-10-14）**：`extract.js` `SOCIAL_HOSTS` 加 `youtube.com`、`youtu.be`（含 m. 子網域），AI 擷取、LINE 收連結、縮圖三處共用同一判斷；畫面與隱私權頁文字加上 YouTube。實測（本機對真實 YouTube，facebookexternalhit UA）：`youtube.com/watch` 與 `youtu.be` 都 200、轉址後仍在 youtube.com、有 og:title／og:description／og:image（i.ytimg.com https）。`npm test` 69/69（extract 測試加 3 個 YouTube 網址與 1 個仿冒網域）。未用真實 Shorts 美食影片驗證 AI 擷取品質
- **管理員直接把人加進群組（2026-10-14，已本機驗證）**：`GET /api/users` 多回 `display_name`、`group_ids`、`group_names`；「我的 → 帳號管理」每個帳號顯示名稱、所屬群組，並有「群組下拉＋加入群組」（只列還沒加入的群組，呼叫既有 `POST /api/list-members`，網站管理員本來就能加任何人到任何群組）。驗證：`npm test` 69/69（lists 新增 1 項）；本機加入後清單與下拉即時更新
- **大頭貼隱私（2026-10-14）**：`GET /avatar/:id` 只給本人、同一群組成員、網站管理員；其他人一律回 404（與「沒有照片」相同，無法猜 id 探測）。驗證：`npm test` 68/68（profile 新增 1 項）
- **帳號綁定（2026-10-14，已本機驗證）**：不同 email 的登入方式可綁成同一人。`migrations/0013_identities.sql`＋`schema.sql`：`user_identities(email PK, user_id)`、`link_requests(token_hash, user_id, expires_at)`；`lib/users.js` `findUserByEmail`（users.email 或 user_identities）供 `ensureUser`、`lists.js` 指定擁有者、`list-members.js` 加成員共用；`lib/links.js`：`startLink`（32 bytes 隨機 token，DB 只存 SHA-256，HttpOnly cookie `foodmap_link` 10 分鐘）、`completeLink`（middleware 對帶 cookie 的請求呼叫：仍是發起帳號時不動作；換成別的 email → 先 `DELETE … RETURNING` 搶下 token 確保只用一次 → 該 email 已有帳號回 `taken` 不合併，否則寫入 identities 回 `linked`；逾時／用過回 `expired`），結果放在可讀 cookie `foodmap_link_result` 讓前端提示後刪除；middleware 多設 `data.loginEmail`、回應附 `data.setCookies`；`/api/link` GET 列出（主要／目前使用中）、POST 開始綁定、DELETE 解除（不能解除主要 email 與正在使用的）。前端「我的 → 登入方式」：列表、解除、「＋ 綁定其他登入方式」（確認後 POST 再導向 `/cdn-cgi/access/logout`）、指紋登入說明。驗證：`npm test` 67/67（新 `test/link.test.mjs` 4 項，經真實 middleware）；本機兩階段（A 按綁定 → 換成新 email 登入）出現「綁定完成」且進到 A 的帳號、清單與名稱；先以 curl 觸發建帳號的 email 則正確回「已有資料無法綁定」。未驗證：正式環境 Access 登出後重新登入的實際流程
- 指紋登入：交給 Auth0 Passkey（漸進式建立，略過後 30 天再詢問，已查證），設定寫進 `docs/setup/password-login.md` 6.5 節；App 只放說明
- **帳號密碼登入（使用者選做法 A，2026-10-13）**：不自建密碼系統，改用 Auth0 免費方案（每月 25,000 位活躍使用者、免信用卡）經 Cloudflare Access「Generic OIDC」接入，程式不用改（App 只讀 Access 的 email）。設定步驟 `docs/setup/password-login.md`；**資安要點**：Auth0 預設未驗證信箱也能登入，必須加 post-login Action `if (!event.user.email_verified) api.access.deny(...)`，否則可冒用他人 email 登進對方帳號。狀態：文件完成，使用者尚未設定、未實測
- **上線待辦（使用者）**：remote 跑 0012（兩個 CREATE TABLE，用 `--command`）→ `npm run deploy` → Access 原則加 Google → OAuth 同意畫面改正式版 →（選填）`LINE_BOT_ID` → 請一位朋友實測登入、建群組、綁 LINE 群組
- 決定：共用同一網站（費用在使用者帳上，靠每人每日上限）、任何 Google 帳號可登入、網站管理員維持看得到所有群組、朋友 LINE 群組由群組擁有者用綁定碼自己綁。三個分支：open-groups → per-user-limits → line-bind-code，最後改文件與 Access 原則說明、加隱私權頁
- **3. 群組擁有者自己綁 LINE 群組 ✅（已本機驗證；未在真實 LINE 群組實測）**：`POST /api/line-bind-code {list_id}`（只限擁有者／管理員，6 碼不含 0/O/1/I，30 分鐘有效、同清單產生新碼會作廢舊碼；有設 `LINE_BOT_ID` 時回傳加好友連結 `https://line.me/R/ti/p/<ID>`）；webhook 收到「綁定 XXXXXX」（大小寫、中間空白皆可）→ 有效碼且該 LINE 群組**尚未綁定**才綁，成功後刪碼（已綁到別的清單不會被搶）；`/api/line-groups?list=ID` 擁有者只看綁到自己群組的、只能解除（`list_id: null`），完整清單仍限管理員。前端：群組成員頁（擁有者）新增「💬 LINE 群組」區：已連結的群組＋解除、產生綁定碼＋三步驟說明、重新整理。驗證：`npm test` 63/63（新 `test/line-bind.test.mjs` 4 項）；本機擁有者頁面顯示已綁群組與綁定碼
- **2. 每人每日上限＋看得到誰用的 ✅（已本機驗證）**：`migrations/0012_friends.sql`（`user_daily_usage`，以及第 3 步要用的 `line_bind_codes`）；`lib/usage.js` `APIS.perUserDaily`（地圖載入 30、地點搜尋 20、AI 擷取 30、座標更新不限）與 `takeUserQuota`（到上限時不再累加，`ON CONFLICT … DO UPDATE … WHERE count < 上限`）；`/api/config` 超過上限不給金鑰（前端顯示「今天開地圖的次數已用完」）、`/api/place-search` 超過回 429、`/api/extract` 改用 `takeUserQuota`（`extract_usage` 表不再寫入）；LINE 每個清單每天最多 20 次 AI（全站 50 次保留，`canUseLineAi`）；`/api/usage` 多回 `per_user_daily`、`top_users`，管理頁每張卡片顯示「每人每天最多 N 次。今天：某某 12、…」。驗證：`npm test` 59/59（usage 2 項、line 1 項）；本機管理頁顯示今日使用者
- **1. 任何人建群組／退出群組 ✅（已本機驗證）**：`POST /api/lists` 不再限管理員，一般人建立的群組擁有者固定是自己（`owner_email` 只有管理員能指定），每人最多擁有 10 個（429）；`DELETE /api/list-members` 成員可移除自己（擁有者仍不能離開、個人清單 404）。前端：清單選單旁「＋」開 dialog 建群組並自動切過去；群組成員頁非擁有者顯示「退出這個群組」，退出後 `foodmap:lists-changed` 事件讓 `app.js` 重新載入清單。驗證：`npm test` 56/56（`test/lists.test.mjs` 新增 2 項）；本機以 A 建群組並邀請 B、再以 B 登入：只看到自己的清單與該群組，A 的「家人」與個人清單皆 404，退出後選單只剩「我的清單」

## 切換分頁時地圖保持繪製（2026-10-13，已本機驗證）
- 使用者回報切換頁面後地圖「重新抓取」擔心浪費預算。查證：Google Dynamic Maps 的計費事件是「成功的 map load」（建立 `google.maps.Map`），拖曳、縮放、切圖層不另計；本 App 每次開啟只建立一次地圖（`mapReady`），正式環境 `api_usage` 只記到 5 次 map load。看到的「重抓」是地圖頁 `display: none` 後回來從 0 尺寸重繪
- 修正：其他分頁時地圖頁改為 `position: fixed; visibility: hidden`（保持尺寸與畫面），回到地圖立即顯示
- 仍會產生新 map load 的情況：重新開啟 App、重新整理（手機系統在背景重整網頁也算）
- 使用者實際遇到的是：到「網站管理」看用量再按返回 → 獨立頁面返回會整個重新載入 App → 每次 +1。已把「網站管理」「群組成員」改成 App 內分頁 `#admin`、`#members?list=ID`（`index.html` 兩個 section；`admin.js`／`members.js` 改為匯出 `showAdmin()`／`showMembers(listId)` 的模組，由 `app.js` 在每次進入分頁時呼叫重新載入資料；`PARENT_TAB` 讓這兩頁時「我的」保持亮起；`admin.html`、`members.html` 已刪除）
- 後續（使用者要求，2026-10-13）：拿掉「網站管理」入口，改為「我的」頁直接列出四項（只有網站管理員看得到，`.admin-only`）：📊 API 用量 `#usage`、🏠 群組管理 `#groups`、💬 LINE 群組 `#line-groups`、🙋 帳號管理 `#accounts`，各自一頁；`admin.js` `showAdmin(view)` 只載入該頁需要的資料，狀態訊息 `#admin-message` 移到目前頁標題下；分頁顯示改為 JS 切換 `.view.is-active`（取代逐一列出的 CSS 選擇器）
- 清單切換移到「清單」分頁頂部（使用者要求，2026-10-13）：`#list-select` 下拉＋👥 群組成員（個人清單時隱藏）＋⬇️ 匯出 CSV 圖示鈕；群組成員頁返回改為「← 清單」且導覽列亮「清單」；「我的」只剩個人資料、管理項目、登出。起因：使用者在 LINE 傳 FB 連結以為沒收到，實際已存進「家人」清單（正式 DB `places` id 2，並已自動定位），但 App 當時停在「我的清單」
- Android 手勢列顏色：使用者 Pixel 10 Pro XL 截圖取樣，最底那條是 `#fffaf5`＝manifest `background_color`（之前 `theme_color` 橘色時底部也不是橘色）→ 改為 `#262626`（深色模式導覽列色）。manifest 無法依深淺色切換，淺色模式下底部會是深色；已安裝的 App 要等 Chrome 更新 WebAPK（可能一天以上）或移除重裝才會套用。**未在手機驗證**
- 驗證：Chrome 走 地圖→我的→網站管理→管理成員→返回→群組成員→地圖，全程同一份文件（navigation 1 次）、`/api/config` 1 次；管理頁用量卡片、群組、成員清單正常、無橫向捲動
- 驗證：Chrome 切換 5 次分頁 `/api/config` 只呼叫 1 次、隱藏時地圖仍為 780px 高、清單可點且不被遮擋

## 個人名稱與大頭貼（2026-10-13，已本機驗證）
- `migrations/0011_profile.sql`＋`schema.sql`：`users.display_name`；`user_avatars(user_id, content_type, image BLOB, updated_at)` 另開一表（middleware 每次請求都 `SELECT * FROM users`，不要帶圖片）
- `GET /api/me` 多回 `id`、`name`、`avatarVersion`；`PATCH /api/me {display_name}`（≤30 字，空白＝回預設 email @ 前面）；`PUT /api/avatar`（原始圖片 body，只收 JPEG/PNG/WebP 且檢查檔頭、≤300 KB）、`DELETE /api/avatar`；`GET /avatar/:userId`（登入的家人都能看，`?v=updated_at` 換網址所以可長快取）；`/api/visits` GET 多回 `name`（家人評價顯示名稱）
- 前端：「我的」頁頂部大頭貼＋名稱＋email＋編輯（dialog：改名、換／移除大頭貼）；點大頭貼直接換照片；瀏覽器端裁成置中正方形、縮成 256px JPEG 再上傳；導覽列「我的」改成小頭像＋名稱；沒照片時顯示名稱第一個字＋每人固定顏色
- 名稱自動帶入：沒設名稱時讀同網域 `/cdn-cgi/access/get-identity` 的 `name`（Google 登入通常有，Email 驗證碼登入沒有）——**未在正式環境驗證** Access 是否回傳 name；Google 大頭貼 Access 不提供，所以改為自行上傳
- 驗證：`npm test` 54/54（新 `test/profile.test.mjs` 3 項：名稱設定／重設／長度、上傳型別與檔頭與大小檢查、取回與刪除、評價帶名稱）；Chrome 390×844：首字頭像、改名（去空白）同步到導覽列、上傳 400×300 圖 → 256×256 JPEG 置中裁切、移除後回到首字

## 清單兩種排列＋影片縮圖＋底部卡片（2026-10-13，已本機驗證）
- 清單頁搜尋框旁切換「☰ 列表」（一列一家：縮圖 56px、店名、距離·食物·地區、新／★／✓評分）與「▦ 縮圖」（兩欄方塊，寬螢幕三欄）；選擇記在 localStorage `foodmap.layout`
- 點任一家 → 底部滑出完整卡片（`#map-card` 移到 body 層，各頁共用；卡片頂部有 180px 縮圖、✕ 有深色底以免被圖蓋住）；換頁時自動關閉（在 `showView` 同步判斷，用 `currentView` 變數而非 `body.dataset.view`，因為動畫版切換會晚一步更新 dataset，造成「在地圖上看」剛打開的卡片被關掉——本機驗證時發現並修正）
- 縮圖：`GET /thumb/:placeId`（`functions/thumb/[id].js`，經 middleware 登入＋`findAccessiblePlace`）；第一次看時抓貼文頁 og:image（只限 IG/FB/Threads 網域、圖片需 https、型別 jpeg/png/webp/gif、≤1 MB），存進 D1 `place_thumbnails`（BLOB；D1 讀回是數字陣列，用 `new Uint8Array` 轉）；失敗記錄 NULL，3 天內不重抓；回應 `Cache-Control: private, max-age=604800`；沒圖時前端顯示 🍜 佔位
- `extract.js` 重構：`fetchSocialPage`（共用抓頁）、`readOgMeta`、`readLimited` 改回傳 `{bytes, truncated}`；`fetchCaption` 行為不變
- `migrations/0010_thumbnails.sql`＋`schema.sql`
- 未驗證：真實 IG/FB/Threads 貼文是否給得到 og:image（本機用假連結，只驗證了存圖與顯示流程）
- 驗證：`npm test` 51/51（新 `test/thumb.test.mjs` 2 項：只抓一次並存 DB、非成員 404、非社群網址不抓、SVG／超過 1 MB 拒絕、失敗 3 天內不重抓）；Chrome 390×844：列表／縮圖切換與記憶、D1 圖片顯示、佔位圖、點擊開卡片、換頁關卡片、今天吃什麼→在地圖上看卡片保持開啟

## API 用量（2026-10-13，已本機驗證；分支 `feature/api-usage`）
- 做法：App 自己記錄每次對外 API 呼叫（不是讀 Google Cloud Monitoring——那需要 service account 金鑰，使用者若要和帳單完全一致的數字再評估）
- `migrations/0009_api_usage.sql`＋`schema.sql`：`api_usage(api, day, count)`；`lib/usage.js`：`APIS`（每日上限與 Google Cloud 配額一致：地圖載入 300、地點搜尋 100、座標更新 30；每月免費 10,000／5,000／10,000；AI 擷取每日約 140 次＝10,000 neurons ÷ 約 70，估計值）、`dayIn`（Google 以太平洋時間、Workers AI 以 UTC 計日，與各自配額重置時間一致）、`recordUsage`、`usageReport`（今日、本月、近 30 天補零）
- 記錄點：`/api/config`（有金鑰時＝一次地圖載入）、`/api/place-search`、LINE 自動定位（地點搜尋）、`refreshStaleLocations`（座標更新）、`/api/extract` 與 LINE（AI 擷取）
- `GET /api/usage`（只限網站管理員）；`public/admin.html`/`admin.js` 最上方「API 用量」：今日 X / 上限＋剩幾次、進度條（≥80% 變紅）、本月 / 免費額度、近 30 天 SVG 長條圖（今天深色，長按／滑過看次數）
- 注意：改 Google Cloud 配額時要同步改 `lib/usage.js` 的 `dailyLimit`（已寫進 `docs/setup/google.md`）
- 驗證：`npm test` 49/49（新 `test/usage.test.mjs` 3 項：時區日界、報表今日／本月／30 天補零、只限管理員與地圖載入計數）；本機 Chrome 390 寬：四張卡片、進度條變紅、長條圖與提示文字、無 console 錯誤、無橫向捲動

## 下一步
1. 使用者（進行中）：Access 已合併為**單一應用程式、兩個目的地**（`foodmap-edl.pages.dev` 與 `*.foodmap-edl.pages.dev`），共用原則「foodmap 家人」（Include Emails，目前只有使用者本人，家人 email 之後再加）；2026-10-12 驗證正式網址、版本網址 c62d6197、不存在的子網域皆 302 → blue-mouse-e3db.cloudflareaccess.com；`ACCESS_AUD` 已設定。待確認：`ACCESS_TEAM_DOMAIN`、`ADMIN_EMAILS` 是否已設；remote 依序跑 0002（若尚未）、0003、0004、0005；`npm run deploy`；刪除舊部署
2. 部署後：管理員到成員頁把自己設為「家人」擁有者、加入家人
3. 使用者照 `docs/setup/line.md` 申請 LINE、設 `LINE_CHANNEL_SECRET`、跑 0006、部署、建 webhook Bypass app、設 Webhook URL、拉 Bot 進群組並在管理頁綁定「家人」，實測擷取品質
4. 帳號密碼登入：已決定做法 A（Auth0 經 Access OIDC），使用者照 `docs/setup/password-login.md` 設定後實測（含「未驗證信箱被擋」）
5. 上線：remote 已有 0007、0008（2026-10-13 查證）；0009 用 `--file` 時遇 `Authentication error [code: 10000]`（匯入 API），已請使用者改用 `--command`；還需 0010、0011（以 `--command` 執行）→ `npm run deploy` → 使用者手機實測地圖、定位、拖曳、Google 搜尋候選、縮圖（真實 IG/FB 是否有 og:image）、Access 是否回傳 name
6. 階段 C：營業時間／Google 評分（開卡片即時查、每日上限、標示 Google）、使用條款／隱私權頁、影片縮圖（R2，需改 `wrangler.toml`）
