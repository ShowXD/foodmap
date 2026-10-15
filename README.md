# 美食地圖 foodmap

把在 IG、FB、Threads、YouTube 看到的美食影片收藏起來，讓 AI 整理出店名、地址和菜色，放到地圖上，和家人朋友一起看、一起記錄吃過沒。

手機加到主畫面就能當 App 用（PWA），不用上架。

## 功能

- **貼連結就好**：AI 從貼文文字整理出店名、地址、菜色、標籤；一則影片介紹好幾家店也能分開存。也可以上傳截圖讓 AI 辨識
- **LINE 群組自動收**：把 LINE Bot 拉進群組，大家貼的美食連結會自動存進清單（Bot 不會說話）
- **地圖**：店家標點、自己的位置、1／3／5 公里範圍、一鍵導航；可按需查看 Google 評分
- **清單**：搜尋、篩選（想吃、未吃、吃過、距離、標籤、待處理）、排序（新到舊、店名、距離）
- **一起用**：每人有私人清單，也可以建群組用邀請連結找人加入；吃過、評分、心得每個人各自記
- **今天吃什麼**：從附近或指定標籤的店裡隨機抽一家
- **整理工具**：疑似亂碼偵測與 AI 重新分析、重複店家自動合併、標籤改名與合併、匯出 CSV

## 技術

沒有使用任何前端框架，也沒有建置步驟。

| 部分 | 用的是 |
| --- | --- |
| 前端 | 原生 HTML／CSS／JavaScript（ES modules），PWA |
| 後端 | Cloudflare Pages Functions |
| 資料庫 | Cloudflare D1（SQLite） |
| AI | Cloudflare Workers AI（Llama 3.3 70B、Qwen3 30B、Gemma 4 26B） |
| 登入 | Cloudflare Access（Google、Email 驗證碼，可接 Auth0 帳號密碼） |
| 地圖 | Google Maps JavaScript API、Places API (New) |
| 部署 | GitHub Actions → Cloudflare Pages |

唯一的套件是開發用的 `wrangler`。

```text
public/      前端（index.html 與各頁模組，無需建置）
functions/   API 路由（Pages Functions）與登入檢查 middleware
lib/         後端共用邏輯（AI、Google、權限、用量）
migrations/  資料庫升級檔（部署時自動套用）
schema.sql   資料庫最新結構
test/        測試（node:test，用 node:sqlite 跑真實 schema）
docs/setup/  各服務的申請與設定步驟
```

## 自己架一份

需要 Cloudflare 帳號；地圖功能需要 Google Cloud 專案（要綁卡，但一般家庭用量在免費額度內）；LINE 功能需要 LINE 官方帳號。

照順序看設定文件：

1. [Cloudflare](docs/setup/cloudflare.md)：Pages、D1、Workers AI、Access 登入、GitHub Actions 自動部署
2. [Google 地圖](docs/setup/google.md)：API 金鑰、用量上限、費用說明
3. [LINE Bot](docs/setup/line.md)（選用）
4. [帳號密碼登入](docs/setup/password-login.md)（選用，Auth0）

所有金鑰都存在 Cloudflare 或 GitHub 的 secrets，不會放進程式碼。

## 開發

需要 Node.js 22.5 以上（測試用到 `node:sqlite`）。

```bash
npm install
npm test

# 本機執行（DEV_USER_EMAIL 只在 localhost 生效，用來模擬登入）
npx wrangler d1 execute foodmap --local --file schema.sql
npx wrangler pages dev public --port 8788 --binding DEV_USER_EMAIL=me@example.com
```

本機沒有 Google 金鑰時地圖會顯示「尚未設定」，清單與其他功能照常可用。

push 到 `main` 後，GitHub Actions 會依序跑測試、套用資料庫升級、部署，並清理舊的部署版本。

## 費用

設計目標是一般家庭用量全部落在免費額度內：Workers AI 每天 10,000 neurons（約 190 次擷取）、Google 地圖每月免費額度，並在程式裡設了全站與每人每日上限。詳細見 [google.md](docs/setup/google.md)。

## 授權

[MIT](LICENSE)
