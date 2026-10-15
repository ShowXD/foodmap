# Google 地圖設定步驟

美食地圖的地圖、店家定位、營業時間和 Google 評分，都用 Google Maps Platform。這份文件帶你建好專案和金鑰，並設好用量上限，避免意外扣款。

> 查證日期：2026-10-13（[價目表](https://developers.google.com/maps/billing-and-pricing/pricing)、[欄位對應的 SKU](https://developers.google.com/maps/billing-and-pricing/sku-details)、[服務條款](https://cloud.google.com/maps-platform/terms/maps-service-terms)）。Google 會調價，有疑問以官方頁面為準。

## 會用到什麼、要多少錢

| 功能 | 用的 API | 計費項目 | 每月免費 | 超過後每 1000 次 |
|---|---|---|---|---|
| 顯示地圖 | Maps JavaScript API | Dynamic Maps | 10,000 次 | US$7 |
| 用店名找位置 | Places API (New) Text Search（只要 ID、名稱、地址、座標） | Text Search Pro | 5,000 次 | US$32 |
| 每 25 天更新一次座標 | Places API (New) Place Details（只要座標） | Place Details Essentials | 10,000 次 | US$5 |
| 營業時間、Google 評分 | Places API (New) Place Details | Place Details Enterprise | **1,000 次** | US$20 |

一家人的用量（一個月幾百次開地圖、新增幾十到一百家店）**全部在免費額度內**。最需要注意的是營業時間和評分，因為每月只有 1,000 次免費。程式只會在你**打開店家卡片時**才查詢，並設每日上限。免費額度是同一個帳單帳戶下所有專案合計。

### 為什麼不把營業時間存起來

Google 條款規定：
- 地點 ID 可以永久保存。
- 經緯度最多暫存 30 天（服務條款 14.3）。
- 其他內容（營業時間、評分、Google 上的店名與地址）原則上不能存。

所以程式只存地點 ID；經緯度記錄抓取時間，超過 25 天自動重抓；營業時間和評分每次即時查詢。你**自己拖曳修正的位置**算你的資料，可以永久保存。

---

## 1. 建立專案並連結帳單

1. 打開 <https://console.cloud.google.com/>，上方選擇專案 → 建立或選擇一個專案，例如 `foodmap`。之前為了 Google 登入建的專案可以直接用。
2. 左側選單 → **帳單**，確認這個專案已經連結到你綁好卡的帳單帳戶。

## 2. 啟用兩個 API

**API 和服務** → **程式庫**，搜尋並啟用：
- **Maps JavaScript API**
- **Places API (New)**：要選有「(New)」的，不要選舊版的「Places API」。

## 3. 建立兩把 API 金鑰

**Google Maps Platform** → **憑證** → **建立憑證** → **API 金鑰**，總共建兩把。

**金鑰 1：瀏覽器用（名稱 `foodmap-browser`）**
- 應用程式限制：**網站**，加入：
  - `https://foodmap-edl.pages.dev/*`
  - `https://*.foodmap-edl.pages.dev/*`（部署版本網址）
  - `http://localhost:8788/*`（本機測試用，可不加）
- API 限制：**限制金鑰** → 只勾 **Maps JavaScript API**

**金鑰 2：伺服器用（名稱 `foodmap-server`）**
- 應用程式限制：**無**。Cloudflare 的對外 IP 不固定，沒辦法設 IP 限制。
- API 限制：**限制金鑰** → 勾 **Places API (New)**，有啟用 YouTube 的話再勾 **YouTube Data API v3**
- 這把金鑰**只存在 Cloudflare secret**，不會出現在網頁或 repo 裡。

> 瀏覽器用的金鑰一定會被看到，這是正常的；靠「只能在你的網址使用」和「只能用地圖 API」來保護。伺服器用的金鑰則絕對不能外流，外流就到憑證頁刪掉重建。

## 4. 建立地圖 ID（Map ID）

新式的地圖標點（Advanced Markers）需要地圖 ID。
**Google Maps Platform** → **地圖管理（Map management）** → **建立地圖 ID**：
- 名稱：`foodmap`
- 地圖類型：**JavaScript**
- 選 **向量（Vector）**

地圖 ID 不是密碼，也不會多收費。

## 5. 設定用量上限與預算警示（防止意外扣款）

**用量上限（真正能擋住扣款的設定）**
**IAM 與管理** → **配額與系統限制**，用服務篩選：
- **Places API (New)**：把 `SearchText`、`GetPlace` 的每分鐘請求數調低，例如每分鐘 10 次。若有「每日」的項目，也設一個上限，例如每天 100 次。
- **Maps JavaScript API**：若有每日地圖載入的上限項目，設成例如每天 300 次。

> 網站管理頁的「API 用量」會用這些數字算「今日剩幾次」。之後若改了配額，也要一起改 `lib/usage.js` 裡的 `dailyLimit`。

**預算警示（只會寄信通知，不會停止扣款）**
**帳單** → **預算與快訊** → **建立預算**：金額 US$5，在 50%、90%、100% 時寄信。帳單資料最多可能延遲 48 小時。

## 6. 把金鑰和地圖 ID 存進 Cloudflare

在 repo 根目錄執行，依序貼上值：

```powershell
npx wrangler pages secret put GOOGLE_MAPS_BROWSER_KEY
npx wrangler pages secret put GOOGLE_MAPS_MAP_ID
npx wrangler pages secret put GOOGLE_PLACES_KEY
npm run deploy
```

- `GOOGLE_MAPS_BROWSER_KEY`：金鑰 1
- `GOOGLE_MAPS_MAP_ID`：第 4 步的地圖 ID
- `GOOGLE_PLACES_KEY`：金鑰 2

瀏覽器金鑰和地圖 ID 會在你登入後由程式提供給網頁（`/api/config`），不會寫進 repo。

## 7. 其他條款要求（給維護者）

- Places 的資料只能顯示在 Google 地圖上，或在旁邊標示 Google 標誌。卡片上的營業時間和評分會標註「資料來源：Google」。
- Places API 政策要求應用程式提供使用條款與隱私權政策頁面，並納入 Google 的條款。
- 網站的安全政策（CSP）要加入 Google 地圖的網域。程式會依[官方 CSP 說明](https://developers.google.com/maps/documentation/javascript/content-security-policy)設定。
