# 專案狀態

> 2026-10-15 整理：已完成功能只留一行摘要，實作細節與當時的驗證紀錄見 git 歷史（`git log -- <檔案>`）。未解決與未驗證的事項全部保留在下方。

## 目標與架構
收藏 IG／FB／Threads／YouTube 美食影片的店家，家人朋友共用清單、在地圖上找、一鍵導航。

- 前端：純 HTML／JS PWA（`public/`），無建置步驟。模組：`shared.js`（API、設定、事件）→ `state.js`（共用狀態、篩選、排序、標籤，純函式可在 node 測）→ `map.js`、`filters.js`、`tags.js`、`add-form.js`、`me.js`、`members.js`、`admin.js` → `app.js`（頁面切換、清單、卡片、啟動）。`map.js`／`filters.js`／`tags.js` 經 `connect*()` 拿到頁面動作，不反向 import `app.js`
- 後端：Cloudflare Pages Functions（`functions/`，路由檔只處理請求）＋ `lib/`（共用邏輯）＋ D1（`schema.sql`＝最新結構、`migrations/` 升級）＋ Workers AI
- 登入：Cloudflare Access（Google、Email 驗證碼、Auth0 帳號密碼），`functions/_middleware.js` 驗 JWT；公開路徑只有 `/api/line/webhook`（LINE 簽章）、`/privacy`、`/welcome/`
- 正式網址 `https://foodmap-edl.pages.dev`；登入前的入口 `/welcome/`
- 部署：push 到 `main` → GitHub Actions（`.github/workflows/deploy.yml`）：`npm test` → `wrangler d1 migrations apply --remote` → `wrangler pages deploy` → 清理舊部署（留 5 個＋上線中）
- 測試：`npm test`（node:test；`test/d1.mjs` 用 node:sqlite 跑真實 `schema.sql`）

## 目前狀態
- 分支：`main`，各功能分支已合併並刪除；push 只在使用者要求時做
- 測試：`npm test` 99/99（2026-10-15）
- 已上線並使用中：地圖／清單／新增／今天吃什麼／我的、群組與邀請連結、LINE Bot 自動收連結、Google 地圖與地點搜尋、AI 擷取、API 用量頁、歡迎頁

## 功能摘要（皆已實作）
- **清單與群組**：每人一份私人「我的清單」；任何人可建群組（每人最多擁有 10 個），用邀請連結（`/welcome/?join=`，7 天、單次）加入；成員可退出；網站管理員可看所有群組、用 email 直接加人
- **店家**：一則影片可有多家店；吃過／評分／心得每人各自；想吃星號；「新」標記；分享；匯出 CSV；影片縮圖（og:image 存 D1）
- **篩選與排序**（`public/filters.js`）：「⚙️ 篩選・排序」面板（排序：新到舊／舊到新／店名／距離；狀態；距離 1／3／5 公里並畫範圍圈；待處理：沒店名／沒定位／疑似亂碼／重複；標籤），條件可組合；列上直接有常用條件（想吃、未吃、3 公里內、附近 5 公里最常用的 3 個標籤）
- **標籤**：寫入與讀取都經 `normalizeTags`／`tagsOf` 去掉 #、＃、引號、括號並去重；AI 最多 3 個、不放地名；「⋯ → 🏷️ 管理標籤」可改名／合併／刪除（`PUT /api/tags`）
- **AI 擷取**（`lib/ai.js`）：模型可在 API 用量頁切換，預設「自動」＝Llama 3.3 70B，亂碼時改用 Qwen3 30B；`groundPlaces` 濾掉貼文沒出現的店名／地址／地區／菜色；`garbledFields` 標出疑似亂碼（手動改過的不判斷）；截圖辨識（Gemma 4 26B）；YouTube 用 Data API 讀完整說明欄與留言；「AI 重新分析」單筆與整批（跟著目前篩選）；LINE 超量的連結在有人開清單時背景補分析
- **定位**（`lib/google.js`、`lib/place-ai.js`）：AI 結果自動搜尋 Google，第一名店名或門牌相符才採用；手動從 Google 候選選或在地圖放標點；Google 座標 25 天重抓、30 天清除（條款）；同清單同 Place ID 自動合併（`lib/merge.js`），自動合併前的舊重複可手動合併
- **Google 評分**：卡片「⭐ Google 評分」按了才查，不儲存（`GET /api/place-rating`）
- **LINE Bot**（`functions/api/line/webhook.js`）：完全不回話；只收已綁定群組的社群連結；收回訊息會刪除；群組擁有者用「綁定 XXXXXX」綁群組
- **帳號**：名稱、大頭貼（只給同群組成員看）；不同 email 的登入方式可綁成同一人；網站管理員可停用帳號
- **用量與上限**（`lib/usage.js`）：各 API 全站每日上限與每人每日上限，管理頁看得到今天誰用了多少

| API | 全站每日 | 每人每日 | 備註 |
|---|---|---|---|
| 地圖載入 | 300 | 30 | |
| 地點搜尋 | 100 | 20 | |
| 座標更新 | 30 | — | 背景執行 |
| Google 評分 | 30 | 10 | Enterprise，每月免費 1,000 |
| YouTube | 10,000 單位 | — | |
| AI 擷取 | 190 | 60 | 2026-10-15 實測每次約 49 neurons（免費每日 10,000） |
| 新增店家／縮圖 | — | 300 | 只佔儲存空間 |

## 使用者端設定狀態
- Cloudflare Access：登入方式 Google、Email 驗證碼、Auth0（使用者 2026-10-15 表示三種都有人用）；Bypass 應用程式：LINE webhook、`privacy`、`welcome`；Access 登入頁外觀已改為美食地圖（logo 用 `/welcome/icon.svg`）
- GitHub Actions secrets：`CLOUDFLARE_API_TOKEN`（Pages 編輯＋D1 編輯）、`CLOUDFLARE_ACCOUNT_ID`；正式 D1 已標記 0002～0016 已套用，之後新 migration 會自動套用
- Cloudflare secrets：`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ADMIN_EMAILS`、`LINE_CHANNEL_SECRET`、`GOOGLE_MAPS_BROWSER_KEY`、`GOOGLE_MAPS_MAP_ID`、`GOOGLE_PLACES_KEY`；選填 `LINE_BOT_ID`（是否已設未確認）

## 待使用者處理
- 部署後手機確認：距離篩選的範圍圈與縮放、Google 評分顯示、YouTube 連結的 AI 填入是否帶出完整說明欄
- 已完成（使用者 2026-10-16 回報）：Google Cloud `GetPlace` 每日上限 60；啟用 YouTube Data API v3 並加進伺服器金鑰的 API 限制；Auth0 post-login Action「Require verified email」

## 未驗證（需真機或正式環境）
- 定位準確度改善（`maximumAge: 0`、誤差圈、精確位置提示）
- Android：Web Share Target 從 LINE 分享進來；手勢列顏色（manifest `background_color`）
- 經 Access 登入後邀請碼 query 是否保留（現在先到 `/welcome/` 再帶進 App）
- Access `/cdn-cgi/access/get-identity` 是否回傳 `name`（自動帶入名稱）
- 帳號綁定在正式環境的登出再登入流程
- 群組擁有者用綁定碼綁真實 LINE 群組
- 真實 IG／FB／Threads 貼文的 og:image 縮圖成功率
- Auth0 擋下未驗證信箱：Action 已設（使用者回報），未實測用未驗證的新帳號登入是否被擋

## 已知問題與限制
- 部分既有 AI 標籤是簡體字（如「予駕鸡」）：新資料已要求繁體，舊的用「管理標籤」手動改
- 沒有 cron：Google 座標只在有人開清單時才過期清除／重抓（不會提供過期座標）
- 自動模式的 Qwen 重試不另計入 AI 用量（只在亂碼時發生）
- `/` 無法自動導向歡迎頁（Access 在程式之前攔截；要做需自訂網域或把 App 搬到 `/app/`）
- 資安評估後不修：群組擁有者可試探 email 是否註冊（L5，現在加人限網站管理員）；其餘理由見 2026-10-15 資安檢查 commit
- 正式 DB 留有不再使用的 `extract_usage` 表與 `places.status` 欄位（無害，未刪）
- SonarQube 未分析 `pending.html`、`privacy.html`；`role="group"` 3 筆刻意不改成 fieldset

## 重要決策
- **Google 條款**：只有 Place ID 可永久存；座標最多 30 天；店名、評分等 Places 內容不存（所以不用 Google 店名覆蓋 AI 店名、「人氣」排序不做，改按需顯示評分）
- **AI**：免費的 Workers AI（不用付費 API）；Gemma 4 看圖品質好但約 30～50 秒，不用在 LINE 背景
- **登入**：不自建密碼系統（Auth0 經 Access OIDC）；歡迎頁只換登入前畫面，驗證仍交給 Access
- **權限**：任何 Google 帳號可登入、直接可用、事後停用；費用由每人每日上限保護
- **LINE Bot 不回話**（沒有表情回應 API，回訊息會吵到群組）
- **不做**：IG／FB 留言、下載影片分析（要登入或違反條款）；離線快取（Service Worker 曾因快取舊登入頁出事，目前刻意不快取）
- **流程**：每個功能一個分支、一個 commit（Conventional Commits、繁中），驗證後 ff 合回 main；push 等使用者要求；推上 GitHub 前跑 gitleaks

## 本機開發
- `npx wrangler pages dev public --port 8788 --binding DEV_USER_EMAIL=me@example.com`（`DEV_USER_EMAIL` 只在 localhost 生效）
- 本機 D1 是空的時：`npx wrangler d1 execute foodmap --local --file schema.sql` 再匯入自己的測試資料（`migrations apply --local` 會要求互動確認）
- 本機沒有 Google 金鑰與 AI：地圖顯示「地圖尚未設定」、評分回 503；AI 相關用測試或正式環境驗證
- 瀏覽器測試注意：同網址只改 `#` 不會重新載入程式，要強制重新整理；停止 wrangler 後 `workerd.exe` 可能殘留佔住 port

## 下一步
- 等使用者回報上方手機實測結果
- 可考慮（使用者未要求）：營業時間（同評分做法，按需查、不儲存）、簡體標籤自動轉繁體
