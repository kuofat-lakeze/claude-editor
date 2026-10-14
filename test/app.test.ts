import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { openDb, channels, contacts, automations, links } from "../src/db.js";
import { createCaptureSender } from "../src/meta/sendApi.js";
import { signBody } from "../src/meta/signature.js";

const APP_SECRET = "secret123";
const PAGE_ID = "PAGE1";
const db = openDb(":memory:");
const sender = createCaptureSender();
const app = createApp({
  db,
  sender,
  publicUrl: "https://bot.example.com",
  graphVersion: "v21.0",
  verifyToken: "verify-me",
  appSecret: APP_SECRET,
  adminPassword: "pw",
  sessionSecret: "s",
});

let server: Server;
let base = "";
const auth = { authorization: "Bearer pw", "content-type": "application/json" };

beforeAll(async () => {
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  channels.upsert(db, { platform: "messenger", external_id: PAGE_ID, name: "測試專頁", access_token: "tok", instagram_login: 0 });
});
afterAll(() => server.close());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postWebhook(body: unknown, sign = true) {
  const raw = JSON.stringify(body);
  return fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sign ? { "x-hub-signature-256": signBody(APP_SECRET, raw) } : {}) },
    body: raw,
  });
}

describe("webhook 驗證", () => {
  it("GET 驗證成功回 challenge", async () => {
    const r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("abc");
  });
  it("GET 驗證 token 錯誤回 403", async () => {
    const r = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc`);
    expect(r.status).toBe(403);
  });
  it("POST 沒簽章回 401", async () => {
    const r = await postWebhook({ object: "page", entry: [] }, false);
    expect(r.status).toBe(401);
  });
});

describe("後台 API 權限", () => {
  it("未登入拒絕", async () => {
    const r = await fetch(`${base}/api/automations`);
    expect(r.status).toBe(401);
  });
  it("密碼登入後可用 cookie", async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "pw" }) });
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const r2 = await fetch(`${base}/api/overview`, { headers: { cookie } });
    expect(r2.status).toBe(200);
    const j = (await r2.json()) as { webhook_url: string };
    expect(j.webhook_url).toBe("https://bot.example.com/webhook");
  });
  it("錯誤密碼 401", async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
    expect(r.status).toBe(401);
  });
});

describe("廣告點擊 → 自動回覆 → 導購連結（核心流程）", () => {
  let automationId = 0;

  it("建立自動化", async () => {
    const r = await fetch(`${base}/api/automations`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "廣告接待",
        trigger_type: "any_ad",
        priority: 5,
        steps: [
          { type: "text", text: "{{first_name}} 你好！" },
          { type: "buttons", text: "點這裡前往", buttons: [{ type: "url", title: "前往官網", url: "https://shop.example.com/landing?utm=ad" }] },
          { type: "tag", tag: "ad-lead" },
        ],
      }),
    });
    expect(r.status).toBe(201);
    const a = (await r.json()) as { id: number };
    automationId = a.id;
  });

  it("驗證錯誤的自動化會被拒絕", async () => {
    const r = await fetch(`${base}/api/automations`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "bad", trigger_type: "ad", trigger_value: "", steps: [] }),
    });
    expect(r.status).toBe(400);
  });

  it("收到廣告 referral 後送出兩則訊息、建立聯絡人與追蹤連結", async () => {
    sender.sent.length = 0;
    const r = await postWebhook({
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: "USER_A" },
              recipient: { id: PAGE_ID },
              timestamp: 1700000000001,
              postback: { title: "開始使用", payload: "GET_STARTED", referral: { ref: "spring", source: "ADS", type: "OPEN_THREAD", ad_id: "AD777" } },
            },
          ],
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("EVENT_RECEIVED");
    await sleep(50);

    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0].recipientId).toBe("USER_A");
    expect(sender.sent[0].message.text).toBe("測試 你好！");

    const tmpl = sender.sent[1].message as { attachment: { payload: { buttons: { type: string; url: string; title: string }[] } } };
    const btn = tmpl.attachment.payload.buttons[0];
    expect(btn.type).toBe("web_url");
    expect(btn.title).toBe("前往官網");
    expect(btn.url.startsWith("https://bot.example.com/r/")).toBe(true);

    const contact = contacts.find(db, 1, "USER_A")!;
    expect(contact.source_ad_id).toBe("AD777");
    expect(contact.source_ref).toBe("spring");
    expect(contact.source_automation_id).toBe(automationId);
    expect(contact.tags).toEqual(["ad-lead"]);
    expect(automations.get(db, automationId)!.triggered_count).toBe(1);

    // 追蹤連結要能轉址並記錄點擊
    const slug = btn.url.split("/r/")[1].split("?")[0];
    const redirect = await fetch(btn.url.replace("https://bot.example.com", base), { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://shop.example.com/landing?utm=ad");
    expect(links.bySlug(db, slug)!.clicks).toBe(1);
  });

  it("Meta 重送同一事件不會重複回覆", async () => {
    sender.sent.length = 0;
    await postWebhook({
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: "USER_A" },
              recipient: { id: PAGE_ID },
              timestamp: 1700000000001,
              postback: { title: "開始使用", payload: "GET_STARTED", referral: { ref: "spring", source: "ADS", type: "OPEN_THREAD", ad_id: "AD777" } },
            },
          ],
        },
      ],
    });
    await sleep(30);
    expect(sender.sent).toHaveLength(0);
  });

  it("模擬 API 不會真的送訊息也不會建立聯絡人", async () => {
    sender.sent.length = 0;
    const r = await fetch(`${base}/api/simulate`, { method: "POST", headers: auth, body: JSON.stringify({ platform: "messenger", ad_id: "ANY" }) });
    const j = (await r.json()) as { matched: { id: number } | null; messages: unknown[] };
    expect(j.matched?.id).toBe(automationId);
    expect(j.messages).toHaveLength(2);
    expect(sender.sent).toHaveLength(0);
    expect(contacts.find(db, 1, "SIMULATED_USER")).toBeUndefined();
  });

  it("一般訊息沒命中任何規則時不回覆，但仍記錄聯絡人", async () => {
    sender.sent.length = 0;
    await postWebhook({
      object: "page",
      entry: [{ id: PAGE_ID, messaging: [{ sender: { id: "USER_B" }, recipient: { id: PAGE_ID }, timestamp: 5, message: { mid: "x", text: "哈囉" } }] }],
    });
    await sleep(30);
    expect(sender.sent).toHaveLength(0);
    expect(contacts.find(db, 1, "USER_B")).toBeDefined();
  });
});
