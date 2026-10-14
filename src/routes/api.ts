import { Router } from "express";
import type { DB, AutomationInput } from "../db.js";
import { automations, channels, contacts, events, links, stats } from "../db.js";
import type { Platform, Step, TriggerType } from "../types.js";
import { createCaptureSender, type Sender } from "../meta/sendApi.js";
import { runAutomation } from "../engine/runner.js";
import { matchAutomation } from "../engine/matcher.js";
import type { IncomingEvent } from "../types.js";
import { parseWebhook } from "../meta/parser.js";
import { handleIncomingEvent } from "../engine/handler.js";

export interface ApiOptions {
  db: DB;
  sender: Sender;
  publicUrl: string;
  graphVersion: string;
  verifyToken: string;
  appSecretConfigured: boolean;
}

const TRIGGER_TYPES: TriggerType[] = ["ad", "ref", "any_ad", "keyword", "postback", "get_started", "default"];
const PLATFORMS = ["any", "messenger", "instagram"] as const;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiRouter(opts: ApiOptions): Router {
  const { db } = opts;
  const router = Router();

  router.get("/overview", (_req, res) => {
    res.json({
      stats: stats(db),
      webhook_url: `${opts.publicUrl}/webhook`,
      verify_token: opts.verifyToken,
      app_secret_configured: opts.appSecretConfigured,
      graph_version: opts.graphVersion,
      channels: channels.list(db).map(maskChannel),
    });
  });

  /* ---- channels ---- */
  router.get("/channels", (_req, res) => res.json(channels.list(db).map(maskChannel)));
  router.post("/channels", (req, res) => {
    const b = req.body ?? {};
    const platform = b.platform as Platform;
    if (platform !== "messenger" && platform !== "instagram") throw new HttpError(400, "platform 必須是 messenger 或 instagram");
    const external_id = String(b.external_id ?? "").trim();
    const access_token = String(b.access_token ?? "").trim();
    if (!external_id) throw new HttpError(400, "請填寫粉絲專頁 ID / IG 帳號 ID");
    const existing = channels.byExternalId(db, external_id);
    if (!access_token && !existing) throw new HttpError(400, "請填寫存取權杖");
    const ch = channels.upsert(db, {
      platform,
      external_id,
      name: String(b.name ?? "").trim() || external_id,
      access_token: access_token || existing!.access_token,
      instagram_login: b.instagram_login ? 1 : 0,
    });
    res.json(maskChannel(ch));
  });
  router.delete("/channels/:id", (req, res) => {
    channels.remove(db, Number(req.params.id));
    res.json({ ok: true });
  });
  /** 用真正的 Graph API 檢查權杖是否有效 */
  router.post("/channels/:id/test", async (req, res) => {
    const ch = channels.get(db, Number(req.params.id));
    if (!ch) throw new HttpError(404, "頻道不存在");
    const host = ch.platform === "instagram" && ch.instagram_login ? "graph.instagram.com" : "graph.facebook.com";
    const r = await fetch(`https://${host}/${opts.graphVersion}/me?fields=id,name`, {
      headers: { authorization: `Bearer ${ch.access_token}` },
    });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    res.status(r.ok ? 200 : 400).json({ ok: r.ok, result: body });
  });

  /* ---- automations ---- */
  router.get("/automations", (_req, res) => res.json(automations.list(db)));
  router.get("/automations/:id", (req, res) => {
    const a = automations.get(db, Number(req.params.id));
    if (!a) throw new HttpError(404, "找不到自動化");
    res.json(a);
  });
  router.post("/automations", (req, res) => {
    res.status(201).json(automations.create(db, validateAutomation(req.body)));
  });
  router.put("/automations/:id", (req, res) => {
    const a = automations.update(db, Number(req.params.id), validateAutomation(req.body));
    if (!a) throw new HttpError(404, "找不到自動化");
    res.json(a);
  });
  router.patch("/automations/:id/enabled", (req, res) => {
    const a = automations.get(db, Number(req.params.id));
    if (!a) throw new HttpError(404, "找不到自動化");
    const { id: _id, triggered_count: _t, created_at: _c, updated_at: _u, ...rest } = a;
    res.json(automations.update(db, a.id, { ...rest, enabled: req.body?.enabled ? 1 : 0 }));
  });
  router.delete("/automations/:id", (req, res) => {
    automations.remove(db, Number(req.params.id));
    res.json({ ok: true });
  });

  /**
   * 模擬：假裝有人從廣告點進來（或送訊息），看會命中哪條規則、送出什麼內容。
   * 不會真的發訊息，也不會寫入聯絡人。
   */
  router.post("/simulate", async (req, res) => {
    const b = req.body ?? {};
    const platform: Platform = b.platform === "instagram" ? "instagram" : "messenger";
    const event: IncomingEvent = {
      platform,
      channel_external_id: String(b.channel_external_id ?? "SIMULATED"),
      sender_id: "SIMULATED_USER",
      timestamp: Date.now(),
      kind: b.postback_payload ? "postback" : b.text ? "message" : "referral",
      text: b.text ? String(b.text) : null,
      postback_payload: b.postback_payload ? String(b.postback_payload) : null,
      referral:
        b.ad_id || b.ref
          ? { source: b.ad_id ? "ADS" : "SHORTLINK", type: "OPEN_THREAD", ref: b.ref ? String(b.ref) : null, ad_id: b.ad_id ? String(b.ad_id) : null, ads_context: null }
          : null,
      raw: null,
    };
    const channelRow = channels.list(db).find((c) => c.platform === platform);
    const match = matchAutomation(event, automations.listEnabled(db), channelRow?.id ?? null);
    if (!match) {
      res.json({ matched: null, messages: [] });
      return;
    }
    const capture = createCaptureSender();
    await runAutomation(match, {
      db,
      sender: capture,
      publicUrl: opts.publicUrl,
      channel: channelRow ?? {
        id: 0,
        platform,
        external_id: "SIMULATED",
        name: "模擬頻道",
        access_token: "",
        instagram_login: 0,
        created_at: "",
      },
      contact: {
        id: 0,
        channel_id: channelRow?.id ?? 0,
        platform,
        psid: "SIMULATED_USER",
        first_name: "小明",
        last_name: "王",
        profile_pic: null,
        source_ad_id: null,
        source_ref: null,
        source_automation_id: null,
        tags: [],
        first_seen: "",
        last_seen: "",
      },
      referral: event.referral,
      text: event.text,
      dryRun: true,
      sleep: async () => {},
    });
    res.json({ matched: { id: match.id, name: match.name }, messages: capture.sent.map((s) => s.message) });
  });

  /** 把一段 Meta webhook 原始 JSON 丟進來跑真實流程（會真的送訊息），方便除錯 */
  router.post("/replay-webhook", async (req, res) => {
    const incoming = parseWebhook(req.body);
    for (const ev of incoming) await handleIncomingEvent(ev, opts);
    res.json({ processed: incoming.length });
  });

  /* ---- contacts / events / links ---- */
  router.get("/contacts", (req, res) => res.json(contacts.list(db, Number(req.query.limit ?? 200))));
  router.get("/contacts/:id", (req, res) => {
    const c = contacts.get(db, Number(req.params.id));
    if (!c) throw new HttpError(404, "找不到聯絡人");
    res.json({ contact: c, events: events.forContact(db, c.id) });
  });
  router.delete("/contacts/:id", (req, res) => {
    contacts.remove(db, Number(req.params.id));
    res.json({ ok: true });
  });
  /** 手動發一則訊息給聯絡人（24 小時互動窗口內才會成功） */
  router.post("/contacts/:id/send", async (req, res) => {
    const c = contacts.get(db, Number(req.params.id));
    if (!c) throw new HttpError(404, "找不到聯絡人");
    const ch = channels.get(db, c.channel_id);
    if (!ch) throw new HttpError(400, "聯絡人所屬頻道已刪除");
    const text = String(req.body?.text ?? "").trim();
    if (!text) throw new HttpError(400, "請輸入訊息");
    await opts.sender.send(ch, c.psid, { text });
    events.log(db, { channel_id: ch.id, contact_id: c.id, type: "sent", summary: `手動送出：${text.slice(0, 60)}` });
    res.json({ ok: true });
  });

  router.get("/events", (req, res) => res.json(events.list(db, Number(req.query.limit ?? 200))));
  router.get("/links", (_req, res) => res.json(links.list(db)));

  return router;
}

function maskChannel<T extends { access_token: string }>(c: T) {
  const t = c.access_token;
  return { ...c, access_token: t.length > 10 ? `${t.slice(0, 6)}…${t.slice(-4)}` : "••••" };
}

export function validateAutomation(body: unknown): AutomationInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? "").trim();
  if (!name) throw new HttpError(400, "請填寫名稱");
  const trigger_type = b.trigger_type as TriggerType;
  if (!TRIGGER_TYPES.includes(trigger_type)) throw new HttpError(400, "觸發類型不正確");
  const trigger_value = String(b.trigger_value ?? "").trim();
  if (["ad", "ref", "keyword", "postback"].includes(trigger_type) && !trigger_value) {
    throw new HttpError(400, "此觸發類型需要填寫觸發條件（廣告 ID / ref / 關鍵字 / payload）");
  }
  const platform = (PLATFORMS as readonly string[]).includes(String(b.platform)) ? (b.platform as "any" | Platform) : "any";
  const channel_id = b.channel_id === null || b.channel_id === undefined || b.channel_id === "" ? null : Number(b.channel_id);
  const steps = validateSteps(b.steps);
  if (steps.length === 0) throw new HttpError(400, "至少要有一個回覆步驟");
  return {
    name,
    enabled: b.enabled === false || b.enabled === 0 ? 0 : 1,
    priority: Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0,
    platform,
    channel_id: Number.isInteger(channel_id) ? channel_id : null,
    trigger_type,
    trigger_value,
    steps,
  };
}

function validateSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "steps 必須是陣列");
  return raw.map((s, i): Step => {
    const o = (s ?? {}) as Record<string, unknown>;
    const where = `步驟 ${i + 1}`;
    switch (o.type) {
      case "text": {
        const text = String(o.text ?? "").trim();
        if (!text) throw new HttpError(400, `${where}：文字不可空白`);
        return { type: "text", text };
      }
      case "buttons": {
        const text = String(o.text ?? "").trim();
        if (!text) throw new HttpError(400, `${where}：按鈕訊息的文字不可空白`);
        const buttons = Array.isArray(o.buttons) ? o.buttons : [];
        if (buttons.length === 0 || buttons.length > 3) throw new HttpError(400, `${where}：按鈕需 1 到 3 個`);
        return {
          type: "buttons",
          text,
          buttons: buttons.map((btn: Record<string, unknown>, j: number) => {
            const title = String(btn.title ?? "").trim();
            if (!title) throw new HttpError(400, `${where} 按鈕 ${j + 1}：請填標題`);
            if (btn.type === "postback") {
              const payload = String(btn.payload ?? "").trim();
              if (!payload) throw new HttpError(400, `${where} 按鈕 ${j + 1}：請填 payload`);
              return { type: "postback", title, payload };
            }
            const url = String(btn.url ?? "").trim();
            if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `${where} 按鈕 ${j + 1}：網址需以 http(s):// 開頭`);
            return { type: "url", title, url, track: btn.track !== false };
          }),
        };
      }
      case "quick_replies": {
        const text = String(o.text ?? "").trim();
        if (!text) throw new HttpError(400, `${where}：文字不可空白`);
        const replies = Array.isArray(o.replies) ? o.replies : [];
        if (replies.length === 0) throw new HttpError(400, `${where}：至少一個快速回覆`);
        return {
          type: "quick_replies",
          text,
          replies: replies.map((r: Record<string, unknown>) => ({
            title: String(r.title ?? "").trim(),
            payload: String(r.payload ?? r.title ?? "").trim(),
          })),
        };
      }
      case "image": {
        const url = String(o.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) throw new HttpError(400, `${where}：圖片網址需以 http(s):// 開頭`);
        return { type: "image", url };
      }
      case "delay":
        return { type: "delay", seconds: Math.max(0, Number(o.seconds) || 0) };
      case "tag": {
        const tag = String(o.tag ?? "").trim();
        if (!tag) throw new HttpError(400, `${where}：標籤不可空白`);
        return { type: "tag", tag };
      }
      case "goto": {
        const id = Number(o.automation_id);
        if (!Number.isInteger(id)) throw new HttpError(400, `${where}：請選擇要跳轉的自動化`);
        return { type: "goto", automation_id: id };
      }
      default:
        throw new HttpError(400, `${where}：不支援的步驟類型 ${String(o.type)}`);
    }
  });
}

export { HttpError };
