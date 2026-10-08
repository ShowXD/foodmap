# Anthropic API 金鑰申請步驟

「AI 自動填入」會呼叫 Claude Haiku 4.5，從貼文文字整理出店名、食物和地區。這需要一把 Anthropic API 金鑰，採預付儲值。

## 費用估算

- Claude Haiku 4.5：每百萬輸入 token US$1、每百萬輸出 token US$5。
- 每次擷取約 1,000 個輸入 token、200 個輸出 token，**一次約 US$0.002**。
- 一個月用 100 次大約 **US$0.20**。

儲值金額**一年後到期，不退款**，所以買最小額度就好。最低儲值額常見是 US$5，但目前官方文件沒寫明，以儲值頁面為準。

---

## 1. 註冊 Console

到 <https://platform.claude.com>（舊網址 console.anthropic.com）註冊並登入。

## 2. 儲值

**Settings** → **Billing** → **Buy credits**

- 付款後馬上可以用。
- 不建議開 **Auto-reload**（自動加值），用量這麼小沒必要。

## 3. 設定每月花費上限（建議）

**Settings** → **Billing** → **Spend limits** → **Set limit**

例如設 US$2。超過上限時 API 會回錯誤，App 上會顯示「AI 服務錯誤」，但手動填寫照常能用。

## 4. 建立 API 金鑰

**Settings** → **API keys**（<https://platform.claude.com/settings/keys>）→ **Create key**

- 名稱填 `foodmap`。
- 可以設定到期日，到期後要重新建立並更新 secret。
- 金鑰（`sk-ant-...`）**只會顯示這一次**，請馬上進行下一步。

## 5. 把金鑰存進 Cloudflare

在 repo 根目錄執行，貼上金鑰：

```bash
npx wrangler pages secret put ANTHROPIC_API_KEY
npx wrangler pages deploy
```

> ⚠️ 金鑰不能寫進任何會被 commit 的檔案，也不要貼到聊天、issue 或截圖裡。
> 本機測試要用的話，放在 `.dev.vars`（已被 `.gitignore` 排除）：
>
> ```
> ANTHROPIC_API_KEY=sk-ant-...
> ```

## 6. 驗證

1. 用手機或電腦登入美食地圖，展開「新增一家店」。
2. 在「貼文文字」貼一段真實的美食貼文。
3. 按 **✨ AI 自動填入**，應該會填好店名、食物和地區。

各種錯誤訊息代表的意思：

| App 顯示 | 原因 |
|---|---|
| AI 擷取尚未設定 ANTHROPIC_API_KEY | secret 沒設，或設完沒有重新部署 |
| AI 金鑰無效 | 金鑰打錯、已撤銷或已過期 |
| AI 服務錯誤（400） | 可能已達每月花費上限，或儲值用完 |
| AI 忙碌中，請稍後再試 | 觸發頻率限制，過一下再試 |

## 金鑰外洩怎麼辦

到 **Settings** → **API keys** 撤銷那把金鑰，建立新的，再重做第 5 步。

## 參考文件

- 取得金鑰：<https://platform.claude.com/docs/en/get-api-key>
- 價格：<https://platform.claude.com/docs/en/about-claude/pricing>
- 付款方式：<https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage>
- 花費上限：<https://platform.claude.com/docs/en/api/rate-limits>
