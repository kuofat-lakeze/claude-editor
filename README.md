# 廣告聊天自動化（ManyChat 平替）

自架的 Messenger / Instagram 聊天自動化工具。核心功能：

> **使用者點了 Meta 廣告（Click to Messenger / Click to Instagram）→ 立刻自動回覆 → 給一顆按鈕把人導到你指定的網址**，並記錄聯絡人、來源廣告、按鈕點擊數。

- 🎯 觸發條件：指定廣告 ID、ref 參數、任何廣告點擊、關鍵字、按鈕 payload、開始使用、預設回覆
- 💬 回覆步驟：文字、文字 + 按鈕（網址 / payload）、快速回覆、圖片、延遲、加標籤、跳轉另一條流程
- 🔗 追蹤連結：按鈕網址會先經過 `/r/<slug>` 再轉址，能統計每條自動化的點擊
- 👥 聯絡人：自動記錄 PSID、名字、來源廣告 ID / ref、標籤、互動時間，可手動回覆
- 🧪 模擬測試：不用真的投廣告，就能看某個廣告 ID / ref / 訊息會命中哪條規則、送出什麼
- 🔐 Webhook 簽章驗證、事件去重（Meta 重送不會回兩次）
- 🗄️ 零外部服務：Node.js 22 內建 SQLite，`npm install` 就能跑

---

## 1. 安裝與啟動

需求：Node.js **22.13 以上**（使用內建 `node:sqlite`）。

```bash
git clone <this repo>
cd meta-ad-chatbot
npm install
cp .env.example .env     # 編輯 .env，至少填 ADMIN_PASSWORD、SESSION_SECRET、META_VERIFY_TOKEN、PUBLIC_URL
npm run dev              # 開發模式（自動重啟）
```

正式部署：

```bash
npm run build
npm start                # 跑 dist/index.js
```

打開 `http://localhost:3000`，用 `ADMIN_PASSWORD` 登入後台。

### 環境變數

| 變數 | 說明 |
| --- | --- |
| `PORT` | 伺服器埠號，預設 3000 |
| `PUBLIC_URL` | 對外網址（給 Meta 回呼、追蹤連結用），例如 `https://bot.example.com` |
| `ADMIN_PASSWORD` | 後台登入密碼 |
| `SESSION_SECRET` | 簽署登入 Cookie 的隨機字串 |
| `META_VERIFY_TOKEN` | Webhook 驗證權杖（自己隨便訂，與 Meta 後台填的一樣即可） |
| `META_APP_SECRET` | Meta App 的 App Secret，用來驗證 Webhook 簽章（正式環境務必填） |
| `META_GRAPH_VERSION` | Graph API 版本，預設 `v21.0` |
| `DATABASE_PATH` | SQLite 檔案位置，預設 `./data/app.db` |

本機測試可用 [ngrok](https://ngrok.com/) 或 Cloudflare Tunnel 把 3000 埠開到外網，把那個 https 網址填到 `PUBLIC_URL`。

---

## 2. Meta 端設定

### 2.1 建立 Meta App

1. 到 [developers.facebook.com/apps](https://developers.facebook.com/apps/) 建立 App（類型選「商家」/ Business）。
2. 加入產品：**Messenger**；若要做 Instagram，也加入 **Instagram**（Instagram API with Facebook Login）。
3. App 設定 → 基本資料，複製 **App Secret** 填到 `.env` 的 `META_APP_SECRET`。

### 2.2 設定 Webhook

Messenger → 設定 → Webhooks：

| 欄位 | 填入 |
| --- | --- |
| 回呼網址 | `{PUBLIC_URL}/webhook` |
| 驗證權杖 | `.env` 的 `META_VERIFY_TOKEN` |
| 訂閱欄位 | `messages`、`messaging_postbacks`、`messaging_referrals`、`messaging_optins` |

然後在「存取權杖」區塊把你的粉絲專頁加進來並**訂閱 Webhook**。Instagram 的 Webhook 欄位同樣勾 `messages`、`messaging_postbacks`、`messaging_referrals`。

後台「總覽」頁會直接顯示要填的網址與權杖。

### 2.3 取得粉絲專頁存取權杖

- 快速測試：Messenger → 設定 → 存取權杖 → 產生權杖（會過期）。
- 正式使用：企業管理平台 → 系統用戶 → 產生權杖，勾選 `pages_messaging`、`pages_manage_metadata`、`pages_read_engagement`、（IG）`instagram_basic`、`instagram_manage_messages`，選不過期。

到後台「頻道」頁新增：平台、粉絲專頁 ID（或 IG 專業帳號 ID）、權杖。按「測試權杖」確認有效。

> **Instagram 的 ID 要填哪個？** Webhook 送來的 `entry.id` 就是要填的 ID。若不確定，先隨便傳一則訊息給你的 IG 帳號，到後台「記錄」頁會看到「收到未設定頻道的事件（instagram 1784xxxx）」，那串數字就是了。

### 2.4 建立「訊息」目標的廣告

在廣告管理員：

1. 行銷活動目標選 **互動 → 訊息**（Click to Messenger / Instagram Direct）。
2. 廣告層級的「訊息範本」可自訂歡迎訊息、冰山問題；**進階 → ref 參數** 可填一個代碼（例如 `spring_sale`），讓本系統分辨是哪支廣告。
3. 不填 ref 也可以：Meta 會在 webhook 帶 `ad_id`，用「指定廣告 ID」或「任何廣告點擊」觸發即可。

---

## 3. 建立你的第一條自動化

後台 → 自動化 → **「⚡ 快速建立：廣告點擊 → 導購」**，會幫你帶出：

1. 文字：`{{first_name}} 你好 👋 感謝你對我們的廣告有興趣！`
2. 文字 + 按鈕：按鈕「立即前往」→ 改成你的網址
3. 加標籤 `ad-lead`

儲存後到「模擬測試」頁，隨便填一個廣告 ID 執行，就能看到會送出什麼。

### 觸發條件怎麼選

| 類型 | 何時觸發 | 條件值 |
| --- | --- | --- |
| 指定廣告 ID | `referral.ad_id` 相符 | 廣告 ID，可逗號分隔多個 |
| ref 參數 | `referral.ref` 相符或以其開頭 | ref 代碼，可多個 |
| 任何廣告點擊 | 來源是 ADS 的任何 referral | 不需 |
| 關鍵字 | 訊息包含任一關鍵字（不分大小寫） | 關鍵字，可多個 |
| 按鈕 payload | 使用者按了按鈕 / 快速回覆 | payload 字串 |
| 開始使用 | 新用戶按「開始使用」且非廣告來源 | 不需 |
| 預設回覆 | 都沒命中的一般訊息 | 不需 |

比對順序：按鈕 payload → 廣告 ID → ref → 任何廣告 → 開始使用 → 關鍵字 → 預設；同一層以「優先度」大者優先。

### 串多步驟流程

在「文字 + 按鈕」裡把按鈕改成「回傳 payload」（例如 `WANT_PRICE`），再建一條「按鈕 payload = WANT_PRICE」的自動化，就能做出分支問答。「快速回覆」步驟同理。

### 可用變數

`{{first_name}}` `{{last_name}}` `{{full_name}}` `{{ad_id}}` `{{ref}}` `{{message}}` `{{psid}}`

---

## 4. API（給進階使用者 / 串接）

所有 `/api/*` 需登入 Cookie，或 header `Authorization: Bearer <ADMIN_PASSWORD>`。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/api/overview` | 統計與 Webhook 設定資訊 |
| GET/POST | `/api/channels` | 頻道列表 / 新增或更新 |
| POST | `/api/channels/:id/test` | 用 Graph API 驗證權杖 |
| GET/POST | `/api/automations` | 自動化列表 / 新增 |
| PUT/DELETE | `/api/automations/:id` | 更新 / 刪除 |
| PATCH | `/api/automations/:id/enabled` | 啟用 / 停用 |
| POST | `/api/simulate` | 模擬事件（不真的送出） |
| POST | `/api/replay-webhook` | 把 Meta 的原始 webhook JSON 重跑一次（會真的送出） |
| GET | `/api/contacts`、`/api/contacts/:id` | 聯絡人 |
| POST | `/api/contacts/:id/send` | 手動發訊息（24 小時窗口內） |
| GET | `/api/events`、`/api/links` | 事件記錄、追蹤連結 |

自動化的 JSON 範例：

```json
{
  "name": "春季廣告",
  "trigger_type": "ref",
  "trigger_value": "spring_sale",
  "platform": "any",
  "priority": 10,
  "steps": [
    { "type": "text", "text": "{{first_name}} 你好！" },
    {
      "type": "buttons",
      "text": "點下方按鈕看活動",
      "buttons": [{ "type": "url", "title": "看活動", "url": "https://example.com/spring", "track": true }]
    },
    { "type": "tag", "tag": "spring" }
  ]
}
```

---

## 5. 專案結構

```
src/
  index.ts            啟動入口
  app.ts              Express 組裝
  config.ts           環境變數
  db.ts               SQLite schema 與資料存取
  types.ts            型別
  meta/
    parser.ts         Webhook payload 正規化（抽出 referral / ad_id / ref）
    sendApi.ts        Graph API 發送 / 取得個人資料
    signature.ts      X-Hub-Signature-256 驗證
  engine/
    matcher.ts        決定事件要跑哪條自動化
    runner.ts         執行步驟、產生追蹤連結
    templates.ts      {{變數}} 替換
    handler.ts        完整處理流程（聯絡人 → 比對 → 執行）
  routes/
    webhook.ts        /webhook
    redirect.ts       /r/:slug 追蹤轉址
    auth.ts           後台登入
    api.ts            後台 REST API
  public/             後台網頁（純 HTML/JS，無建置）
test/                 vitest 測試
```

```bash
npm test          # 跑測試
npm run typecheck # 型別檢查
```

---

## 6. 常見問題

**點了廣告沒有回覆？**
到後台「記錄」頁看：

- 「收到未設定頻道的事件」→ 到「頻道」頁新增該 ID。
- 「Webhook 簽章驗證失敗」→ `META_APP_SECRET` 填錯。
- 有 `referral` 事件但沒有「觸發自動化」→ 沒有規則命中，用「模擬測試」檢查條件。
- 有「步驟送出失敗」→ 看錯誤內容，通常是權杖過期或權限不足。
- 什麼都沒有 → Meta 後台的 Webhook 沒訂閱到那個粉絲專頁，或 `PUBLIC_URL` 不通。

**App 還在開發模式，別人收不到回覆？**
開發模式只有 App 的管理員 / 開發者 / 測試人員能互動。要對所有人生效需送審 `pages_messaging`（IG 則 `instagram_manage_messages`）並切換為上線模式。

**24 小時規則**
Meta 只允許在使用者最後一次互動後 24 小時內主動發訊息。廣告點擊觸發的回覆一定在窗口內；後台「手動發送」超過 24 小時會失敗。
