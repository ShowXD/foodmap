# 專案狀態

## 目標
收藏 LINE 群組裡的 IG/FB 美食影片連結，家人共用、可搜尋、一鍵開 Google Maps。
架構：純 HTML/JS PWA + Cloudflare Pages Functions + D1，登入用 Cloudflare Access。

## 目前分支
- `feature/pwa-skeleton`：階段 1（76c6dcd）+ `.gitignore`（be45902），未 push、未合併 main
- `feature/share-target`：從 be45902 分出，階段 2 已實作、尚未 commit

## 階段
1. PWA 骨架 + 手動新增 + 搜尋 — **已實作、本機驗證通過**
2. Web Share Target（Android 從 LINE 分享進來）— **已實作、本機驗證通過**，尚未在 Android 實機測
   - manifest `share_target` GET 到 `/`；`app.js` 的 `prefillFromShare()` 從 url/text/title 抓第一個 http(s) 連結填入，其餘文字放貼文欄，`source=share`
   - 注意：hidden input 設值會連預設值一起改，表單 reset 後必須手動設回 `manual`
3. AI 擷取（抓 og 文字 → Claude Haiku 4.5 抽店名/食物/地區）— 未開始
4. LINE Bot webhook 自動收連結（驗 `x-line-signature`）— 未開始

## 階段 1 內容
- `schema.sql`：`places` 表（url UNIQUE、status 限 todo/visited）
- `functions/api/places.js`：GET `?q=`（LIKE 搜尋）、POST（url 需 http(s)，重複回 409）、PATCH（`{id, ...欄位}`，欄位白名單）
- `public/`：`index.html`、`app.js`、`style.css`、`manifest.webmanifest`、`sw.js`（network-first，只快取殼，不碰 `/api/`）、`icon.svg`
- `wrangler.toml`：`database_id` 仍是佔位字串，部署前要填

## 驗證結果（2026-10-08）
- `node --test test/places.test.mjs`：3/3 通過
- `npx wrangler@4 pages dev`（D1 local，persist 到 repo 外）：POST 201、重複 409、`javascript:` url 400、搜尋命中/未命中、PATCH 200/404、靜態檔全 200
- Chrome：表單新增 → 列表出現、導航連結正確、console 無錯誤
- 尚未驗證：實際部署、PWA 安裝、Cloudflare Access

## 資安約束（repo 預計公開）
- 任何金鑰（Anthropic、LINE channel secret/token）只放 Cloudflare secret 或本機 `.dev.vars`，不進 repo（`.gitignore` 已排除 `.dev.vars*`、`.env*`、`.wrangler/`）
- API 本身沒有驗證，部署前必須先設好 Cloudflare Access，否則任何人都能讀寫；`/api/line/webhook` 例外，改驗 LINE 簽章
- 測試資料只用虛構內容，不放家人真實資料或 email

## 待決事項
- 使用者需自備：Cloudflare 帳號、Anthropic API key、LINE Messaging API channel、家人 email 白名單

## 階段 2 驗證（2026-10-08）
- 本機 `wrangler pages dev` + Chrome：`/?text=這家好好吃 <IG連結>&url=<IG連結>` → 表單自動展開、連結與貼文文字正確帶入、網址列清掉 query；存檔後 DB `source=share`，表單 `source` 回到 `manual`；console 無錯誤
- 本機 dev 注意：背景停止 wrangler 時 `workerd.exe` 可能殘留佔住 port 8788 且無回應，需手動結束

## 下一步
1. 使用者決定是否 commit 階段 2
2. 階段 3、4 開工前需使用者決定的事項（見對話）與準備 Anthropic API key、LINE channel
