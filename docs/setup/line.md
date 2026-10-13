# LINE Bot 設定步驟

讓 Bot 加入家庭群組，有人貼 IG/FB/Threads 連結時自動收進美食地圖的「家人」清單。**Bot 不會在群組裡發任何訊息。**

請先完成 [Cloudflare 設定](cloudflare.md)，這裡要用到部署好的網址。以下 `<專案>` 都換成你的 Pages 網址，例如 `foodmap-edl`。

## 先跟家人說明

- **Bot 進群組後會收到群組裡的所有訊息**。這是 LINE 的設計，沒有開關能限制。
- 程式只保存 IG/FB/Threads 連結，以及同一則訊息裡的文字（當作貼文說明給 AI 分析），其他訊息收到就丟掉，不會儲存。
- 有人收回（unsend）含連結的訊息時，美食地圖會刪掉從那則訊息存下的店家。
- 一個群組同時只能有一個官方帳號。

## 運作方式

- 每則訊息最多處理 3 個 IG/FB/Threads 連結。
- AI 會分析出貼文裡的每一家店，各存一筆，來源標示為 LINE。
- AI 失敗、額度用完、或抓不到店名時，仍會存一筆**只有連結**的紀錄，之後在 App 裡按「編輯」補上，連結不會遺失。
- LINE 自動分析每天最多 50 次，超過的只存連結，避免用光 AI 免費額度。
- **Bot 只會收「已綁定」的群組**。被拉進任何群組時都只會先記錄，要到 App 的「管理」頁綁定到「家人」清單後才開始收。就算外人把 Bot 拉進別的群組，也進不了你們的清單。

## 費用

- 台灣「輕用量」方案免費，每月 200 則訊息額度。
- 這個 Bot 只「收」訊息、不「發」訊息，**完全不會用到額度**。
- 數字來自第三方整理，官方台灣頁面未能確認。

---

## 1. 建立 LINE 官方帳號

1. 到 <https://manager.line.biz/> 用 LINE 帳號登入，建立 LINE Business ID。
2. 填表建立一個新的官方帳號，名稱例如「美食地圖」，類別選個人或餐飲都可以。

## 2. 啟用 Messaging API

1. 在 LINE Official Account Manager 進入剛建立的帳號 → **設定** → **Messaging API** → **啟用 Messaging API**。
2. 第一次使用要註冊開發者資訊（姓名、email）。
3. 選擇或建立一個 **Provider**（例如「foodmap」）。**Provider 建立後無法更換**。

完成後會自動在 LINE Developers Console 建立一個 Messaging API channel。

## 3. 關閉自動回覆、開啟加入群組

**在 LINE Official Account Manager**（**設定** → **回應設定**）：

- **加入好友的歡迎訊息** → 關閉
- **自動回應訊息** → 關閉
- **Webhook** → 開啟

**在 LINE Developers Console**（<https://developers.line.biz/console/> → 選你的 channel → **Messaging API** 分頁）：

- **Allow bot to join group chats** → 改成 **Enabled**（預設是關閉的）
- **Auto-reply messages**、**Greeting messages** → 確認都是 Disabled

## 4. 取得 Channel secret 並存進 Cloudflare

這個 Bot 只接收訊息、不發送，所以**只需要 Channel secret**，不需要 Channel access token。

1. LINE Developers Console → channel → **Basic settings** 分頁 → 找到 **Channel secret**。
2. 在 repo 根目錄執行，貼上 secret：

   ```bash
   npx wrangler pages secret put LINE_CHANNEL_SECRET
   ```

> ⚠️ Channel secret 用來驗證「請求真的來自 LINE」。外洩的話，別人就能偽造訊息塞資料進美食地圖。
> 它不能寫進 repo，也不要截圖分享。外洩時到 **Basic settings** 重新產生，再重做這一步。

## 5. 升級資料庫並部署

```bash
npx wrangler d1 execute foodmap --remote --file=./migrations/0006_line.sql
npm run deploy
```

部署完記得照 [cloudflare.md](cloudflare.md) 的規則，刪掉舊部署。

## 6. 讓 webhook 路徑繞過 Access

LINE 的伺服器沒辦法登入，所以 `/api/line/webhook` 這一個路徑要放行。安全性改由程式驗證 LINE 簽章把關：簽章不對一律回 401。

1. **Zero Trust** → **Access 控制** → **應用程式** → **建立新應用程式** → **自我裝載（Self-hosted）**
2. 名稱：`foodmap LINE webhook`
3. 目的地：子網域留空，網域選 `<專案>.pages.dev`，**路徑**填 `api/line/webhook`
4. 原則：新增一條，動作選 **略過（Bypass）**，包含選 **所有人（Everyone）**
5. 儲存

路徑較長的應用程式優先，不會影響其他頁面的保護。

**驗證（在你電腦上執行）**：

```powershell
curl.exe -s -o NUL -w "%{http_code}" -X POST https://<專案>.pages.dev/api/line/webhook
```

應該印出 **401**，代表已經打到程式，只是沒有 LINE 簽章。如果是 **302**，代表 Access 還在擋，回頭檢查這一步。

## 7. 設定 Webhook URL

LINE Developers Console → channel → **Messaging API** 分頁：

1. **Webhook URL** → **Edit**，填入 `https://<專案>.pages.dev/api/line/webhook`，按 **Update**。
2. 按 **Verify**，應該顯示 **Success**。
3. **Use webhook** → 開啟。

## 8. 把 Bot 加進家庭群組並綁定

1. 用手機加 Bot 為好友：Developers Console 的 **Messaging API** 分頁有 QR code。
2. 在家庭群組 → 右上選單 → **邀請** → 選這個 Bot。Bot 加入後不會說話，這是正常的。
3. 在群組裡隨便發一則訊息，讓美食地圖記錄到這個群組。
4. 到美食地圖的 **管理** 頁 → **LINE 群組**，會看到一個「LINE 群組 …xxxxxx」，把它旁邊的選單改成 **收進「家人」**。

## 9. 驗證

1. 在群組貼一個 IG 或 FB 的美食影片連結，最好連同幾句說明文字一起貼。
2. 等幾秒，打開美食地圖切到「家人」，應該多出來源是 LINE 的店家。
3. 收回剛剛那則訊息，重新整理後那幾筆應該消失。

AI 沒抓到店名的話，那筆只會有連結，按「編輯」補上就好。

## 參考文件

- 開始使用 Messaging API：<https://developers.line.biz/en/docs/messaging-api/getting-started/>
- 建立 Bot、設定 webhook：<https://developers.line.biz/en/docs/messaging-api/building-bot/>
- 群組聊天：<https://developers.line.biz/en/docs/messaging-api/group-chats/>
- 會收到哪些事件：<https://developers.line.biz/en/docs/messaging-api/receiving-messages/>
- 簽章驗證：<https://developers.line.biz/en/docs/messaging-api/receiving-messages/#verify-signature>
