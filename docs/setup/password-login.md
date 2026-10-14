# 帳號密碼登入設定步驟（Auth0）

讓家人朋友除了「Google 登入」「Email 驗證碼」之外，也能用 **email＋自己設的密碼**登入。
密碼由 Auth0 保管（註冊、忘記密碼、擋暴力猜密碼都由它處理），App 本身不存任何密碼、程式不用改。

> 查證日期：2026-10-13（[Auth0 價格](https://auth0.com/pricing)、[Cloudflare Generic OIDC](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/)、[Auth0 post-login Action](https://auth0.com/docs/customize/actions/explore-triggers/signup-and-login-triggers/login-trigger/post-login-api-object)）。

## 先了解

- **費用**：Auth0 免費方案每月最多 25,000 位活躍使用者，註冊不用信用卡。
- **同一個人＝同一個 email**：App 用 email 認人。同一個 email 不管用 Google、驗證碼還是密碼登入，都是同一個帳號、同一份資料。
- **一定要做第 4 步「沒驗證信箱不能登入」**：否則有人可以拿別人的 email 註冊，然後登進那個人的帳號。

## 1. 註冊 Auth0、建立租戶

1. 到 <https://auth0.com/signup> 註冊（可用 Google 帳號）。
2. 建立租戶（Tenant）時：
   - **Region**：選 **Japan**（離台灣最近）。
   - 租戶名稱例如 `foodmap`，網域會是 `foodmap.jp.auth0.com` 這種樣子，下面稱為 **`<auth0 網域>`**。

## 2. 建立應用程式（給 Cloudflare 用）

**Applications** → **Applications** → **Create Application**：

- 名稱：`foodmap Cloudflare Access`
- 類型：**Regular Web Applications** → Create

到這個應用程式的 **Settings**：

- **Allowed Callback URLs** 填：
  ```
  https://<team>.cloudflareaccess.com/cdn-cgi/access/callback
  ```
  `<team>` 是你的 Zero Trust 團隊名稱，就是登入頁網址 `https://<team>.cloudflareaccess.com` 開頭那段。
- 按 **Save Changes**。
- 抄下同一頁的 **Domain**、**Client ID**、**Client Secret**（Client Secret 只貼進 Cloudflare，**不要**存到 repo 或傳給別人）。

到這個應用程式的 **Connections** 分頁：

- **Database**：只開 **Username-Password-Authentication**。
- **Social**：全部關掉（Google 登入已經由 Cloudflare 直接提供，避免重複）。

## 3. 密碼規則與防護

**Authentication** → **Database** → **Username-Password-Authentication**：

- **Settings** 分頁：**Disable Sign Ups** 保持**關閉**（朋友要能自己註冊）。
- **Authentication Methods** 分頁 → **Password** → **Configure**：**Password Policy** 選 **Good** 以上。（Passkey 可先不開。）
- **Applications** 分頁：確認第 2 步建立的應用程式是開啟的。

> 註冊後頁面上方會出現付費功能的試用橫幅，到期自動回到免費方案，**不用填信用卡**；這裡用到的功能（含第 4 步的 Actions）都在免費方案內。

**Security** → **Attack Protection**：確認 **Brute-force Protection** 是開啟的（預設開）。

## 4. 沒驗證信箱就不能登入（必做）

Auth0 註冊後會自動寄驗證信，但預設**沒驗證也能登入**，所以要加一條規則：

**Actions** → **Library** → **Build Custom**：

- 名稱：`Require verified email`
- Trigger：**Login / Post Login**
- 程式碼整段換成：

```js
exports.onExecutePostLogin = async (event, api) => {
  if (!event.user.email_verified) {
    api.access.deny('請先到信箱點開 Auth0 寄來的驗證信，再回來登入。');
  }
};
```

- 按 **Deploy**，然後到 **Actions** → **Triggers** → **post-login**，把這個 Action 拖進流程（Start 和 Complete 之間）→ **Apply**。

## 5. 接到 Cloudflare Access

**Cloudflare Zero Trust** → **整合（Integrations）** → **身分識別提供者（Identity providers）** → **新增** → **OpenID Connect**：

| 欄位 | 填什麼 |
|---|---|
| 名稱 | `帳號密碼`（會顯示在登入頁的按鈕上） |
| App ID（Client ID） | 第 2 步的 Client ID |
| Client secret | 第 2 步的 Client Secret |
| Auth URL | `https://<auth0 網域>/authorize` |
| Token URL | `https://<auth0 網域>/oauth/token` |
| Certificate URL | `https://<auth0 網域>/.well-known/jwks.json` |
| Proof Key for Code Exchange (PKCE) | 開啟 |
| Scopes／Email claim | 保持預設（`openid email profile`；email claim 為 `email`） |

存檔後按 **Test**，用一個已驗證信箱的 Auth0 帳號試登入，應該看到成功並帶出 email。

> 這些網址也可以在 `https://<auth0 網域>/.well-known/openid-configuration` 查到（`authorization_endpoint`、`token_endpoint`、`jwks_uri`）。

## 6. 讓 foodmap 接受這個登入方式

1. **Access 控制** → **應用程式** → foodmap → **登入方法**：勾選新的 **帳號密碼**（One-time PIN、Google 保留）。
2. **Access 控制** → **原則** → `foodmap 家人`：在包含（Include）**新增一條**：**登入方法（Login Methods）** = **帳號密碼**。
   - 原本的「電子郵件」「登入方法 = Google」照舊保留，Include 之間是「或」。

## 6.5 指紋／臉部辨識登入（Passkey，選做）

> 查證：[Auth0 Passkey 設定](https://auth0.com/docs/authenticate/database-connections/passkeys/configure-passkey-policy)（2026-10-14）。免費方案包含 Passkey。

先確認 Auth0 的前置條件：

- **Authentication** → **Authentication Profile**：選 **Identifier First**（先輸入 email、再輸入密碼）。
- **Branding** → **Universal Login**：使用新版 Universal Login，且「Custom Login Page」關閉。
- 資料庫連線不要求「username」（預設就不要求）。

開啟：**Authentication** → **Database** → **Username-Password-Authentication** → **Authentication Methods** → **Passkey** → **Configure** → 開啟並保持：

- **Progressive Enrollment** 勾選：用密碼登入後會詢問「要不要建立 passkey」。**按略過的話，30 天後會再詢問**，所以拒絕過的人之後仍然能開啟。
- **Local Enrollment** 勾選：換新手機時會詢問是否在那台手機也建立。

Google 登入的人不經過 Auth0；他們可以到自己的 Google 帳號設定「密碼金鑰」，登入 Google 時就是按指紋。

## 7. 實測

1. 用無痕視窗打開 App → 登入頁會多一個「帳號密碼」按鈕。
2. 用一個新 email **Sign up** → 還沒點驗證信就登入：應該被擋下並看到「請先到信箱點開驗證信」。
3. 點開驗證信後再登入 → 進到 App，會自動有自己的「我的清單」。
4. 試「Forgot password?」→ 會收到重設密碼信。

## 給朋友的使用說明（可以直接轉貼）

> 打開美食地圖網址 → 選「帳號密碼」→ 第一次按 **Sign up**，用 email 和密碼註冊 → 到信箱點驗證信 → 回來登入。忘記密碼就按 **Forgot password?**。有 Google 帳號的話直接按 Google 登入也可以。

## 不同 email 的登入方式綁成同一個人

同一個 email 用哪種方式登入都是同一個人。如果有人的密碼帳號和 Google 帳號 email 不同，在 App「我的 → 登入方式 → 綁定其他登入方式」：App 會先登出，請他在 10 分鐘內用另一個帳號登入，回來就綁好了。已經有自己資料的帳號不能綁（請管理員處理）；綁定可在同一處解除。

## 注意事項

- **登出**：App 的「登出」只登出 Cloudflare；Auth0 那邊的登入狀態可能還在，同一台手機下次按「帳號密碼」會直接進來。借別人手機登入時，用完請清除瀏覽器的網站資料或用無痕視窗。
- **停用某人**：在 App「我的 → 帳號管理」停用即可（Auth0 帳號可留著，也可到 Auth0 → User Management → Users 刪除）。
- Cloudflare Zero Trust 免費方案 **50 位使用者**的上限是所有登入方式合計。
- Client Secret 外流時：Auth0 應用程式 Settings → **Rotate** 產生新的，再更新 Cloudflare 身分識別提供者的設定。
