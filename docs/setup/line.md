# LINE Bot 申請步驟

讓 Bot 加入家庭群組，有人貼 IG/FB 連結時自動收進美食地圖。**Bot 不會在群組裡發任何訊息。**

請先完成 [Cloudflare 設定](cloudflare.md)，這裡要用到部署好的網址。

> ℹ️ 這份文件的第 4、6 步要等**第四階段（LINE webhook 程式）完成部署**後才能做。第 1～3、5 步可以先做。

## 先跟家人說明

- **Bot 進群組後會收到群組裡的所有訊息**。這是 LINE 的設計，沒有開關能限制。
- 程式只保存 IG/FB 連結，其他訊息收到就丟掉，不會儲存。
- 有人收回（unsend）含連結的訊息時，美食地圖會刪掉那一筆。
- 一個群組同時只能有一個官方帳號。

## 費用

- 台灣「輕用量」方案免費，每月 200 則訊息額度。
- 這個 Bot 只「收」訊息、不「發」訊息，**完全不會用到額度**。
- 數字來自第三方整理，官方台灣頁面未能確認；2026-11-01 起中、高用量方案漲價，輕用量維持免費。

---

## 1. 建立 LINE 官方帳號

1. 到 <https://manager.line.biz/> 用 LINE 帳號登入，建立 LINE Business ID。
2. 填表建立一個新的官方帳號，名稱例如「美食地圖」，類別選個人或餐飲都可以。

## 2. 啟用 Messaging API

1. 在 LINE Official Account Manager 進入剛建立的帳號 → **設定** → **Messaging API** → **啟用 Messaging API**。
2. 第一次使用要註冊開發者資訊（姓名、email）。
3. 選擇或建立一個 **Provider**（例如「foodmap」）。**Provider 建立後無法更換**，名稱取好一點。

完成後會自動在 LINE Developers Console 建立一個 Messaging API channel。

> 直接在 LINE Developers Console 建立 channel 的舊流程已經停用，請照上面從 Official Account Manager 開始。

## 3. 關閉自動回覆、開啟加入群組

**在 LINE Official Account Manager**（**設定** → **回應設定**）：

- **加入好友的歡迎訊息** → 關閉
- **自動回應訊息** → 關閉
- **Webhook** → 開啟

**在 LINE Developers Console**（<https://developers.line.biz/console/> → 選你的 channel → **Messaging API** 分頁）：

- **Allow bot to join group chats** → 改成 **Enabled**（預設是關閉的）
- **Auto-reply messages**、**Greeting messages** → 確認都是 Disabled（點旁邊的 Edit 會跳回 Official Account Manager）

## 4. 設定 Webhook URL（第四階段部署後）

LINE Developers Console → channel → **Messaging API** 分頁：

1. **Webhook URL** → **Edit**，填入：

   ```
   https://foodmap.pages.dev/api/line/webhook
   ```

   如果你的 Pages 專案不叫 foodmap，網域就換成你自己的。
2. 按 **Update**，再按 **Verify**，應該顯示 **Success**。
   顯示 302 的話，代表 Access 擋住了這個路徑，回頭檢查 [cloudflare.md 第 5-4 步](cloudflare.md#5-4-讓-line-webhook-路徑繞過-access)；顯示 401 的話，通常是 `LINE_CHANNEL_SECRET` 沒設或貼錯。
3. **Use webhook** → 開啟。

## 5. 取得 Channel secret 並存進 Cloudflare

這個 Bot 只接收訊息、不發送，所以**只需要 Channel secret**，不需要 Channel access token。

1. LINE Developers Console → channel → **Basic settings** 分頁 → 找到 **Channel secret**。
   （未驗證：欄位可能在不同分頁，找不到就在 channel 頁面內搜尋 "Channel secret"。）
2. 在 repo 根目錄執行，貼上 secret：

   ```bash
   npx wrangler pages secret put LINE_CHANNEL_SECRET
   npx wrangler pages deploy
   ```

> ⚠️ Channel secret 用來驗證「請求真的來自 LINE」。外洩的話，別人就能偽造訊息塞資料進美食地圖。
> 它不能寫進 repo，也不要截圖分享。外洩時到 **Basic settings** 重新產生（Issue），再重做這一步。

## 6. 把 Bot 加進家庭群組（第四階段部署後）

1. 用手機加 Bot 為好友：Developers Console 的 **Messaging API** 分頁有 QR code。
2. 在家庭群組 → 右上選單 → **邀請** → 選這個 Bot。
3. Bot 加入後不會說話，這是正常的。

## 7. 驗證

1. 在群組貼一個 IG 或 FB 的美食影片連結。
2. 打開美食地圖重新整理，應該多一筆來源是 LINE 的店家。AI 會盡量填好店名；沒填好的話，按「編輯」補上。
3. 收回剛剛那則訊息，重新整理後那一筆應該消失。

## 參考文件

- 開始使用 Messaging API：<https://developers.line.biz/en/docs/messaging-api/getting-started/>
- 建立 Bot、設定 webhook：<https://developers.line.biz/en/docs/messaging-api/building-bot/>
- 群組聊天：<https://developers.line.biz/en/docs/messaging-api/group-chats/>
- 會收到哪些事件：<https://developers.line.biz/en/docs/messaging-api/receiving-messages/>
- 簽章驗證：<https://developers.line.biz/en/docs/messaging-api/receiving-messages/#verify-signature>
