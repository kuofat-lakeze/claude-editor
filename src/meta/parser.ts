import type { IncomingEvent, Platform, Referral } from "../types.js";

/**
 * 把 Meta Webhook 的 payload 正規化成一串 IncomingEvent。
 *
 * 廣告點擊（Click-to-Messenger / Click-to-Instagram）會以下列其中一種形式出現：
 *  1. messaging_referrals：使用者已經跟專頁對話過，直接帶 referral
 *  2. postback（GET_STARTED）內含 referral：新用戶按「開始使用」
 *  3. message 內含 referral：廣告有預設訊息 / 冰山問題，使用者送出的第一則訊息會帶 referral
 * 三種都統一抽成 event.referral，讓後面的規則引擎只看一個欄位。
 */
export function parseWebhook(body: unknown): IncomingEvent[] {
  const out: IncomingEvent[] = [];
  if (!body || typeof body !== "object") return out;
  const b = body as { object?: string; entry?: unknown[] };
  const platform: Platform | null =
    b.object === "page" ? "messenger" : b.object === "instagram" ? "instagram" : null;
  if (!platform || !Array.isArray(b.entry)) return out;

  for (const entry of b.entry as Array<Record<string, unknown>>) {
    const channelExternalId = String(entry.id ?? "");
    const messaging = (entry.messaging ?? entry.standby ?? []) as Array<Record<string, unknown>>;
    for (const m of messaging) {
      const sender = (m.sender as { id?: string } | undefined)?.id;
      const recipient = (m.recipient as { id?: string } | undefined)?.id;
      if (!sender) continue;
      // 專頁自己送出的訊息（echo）不處理
      const message = m.message as Record<string, unknown> | undefined;
      if (message?.is_echo) continue;
      // 有些情況 sender 是專頁自己
      if (recipient && sender === channelExternalId) continue;

      const timestamp = Number(m.timestamp ?? Date.now());
      let kind: IncomingEvent["kind"] = "other";
      let text: string | null = null;
      let postbackPayload: string | null = null;
      let referral: Referral | null = null;

      if (message) {
        kind = "message";
        text = typeof message.text === "string" ? message.text : null;
        // quick reply 的 payload 當成 postback 處理
        const qr = message.quick_reply as { payload?: string } | undefined;
        if (qr?.payload) {
          kind = "postback";
          postbackPayload = qr.payload;
        }
        if (message.referral) referral = normalizeReferral(message.referral);
      } else if (m.postback) {
        const pb = m.postback as Record<string, unknown>;
        kind = "postback";
        postbackPayload = typeof pb.payload === "string" ? pb.payload : null;
        if (pb.referral) referral = normalizeReferral(pb.referral);
        if (typeof pb.title === "string") text = pb.title;
      } else if (m.referral) {
        kind = "referral";
        referral = normalizeReferral(m.referral);
      } else {
        // read / delivery / reaction 等，不需要回覆
        continue;
      }

      out.push({
        platform,
        channel_external_id: channelExternalId,
        sender_id: sender,
        timestamp,
        kind,
        text,
        postback_payload: postbackPayload,
        referral,
        raw: m,
      });
    }
  }
  return out;
}

export function normalizeReferral(r: unknown): Referral | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const adsContext = (o.ads_context_data as Record<string, unknown> | undefined) ?? null;
  return {
    source: str(o.source),
    type: str(o.type),
    ref: str(o.ref),
    ad_id: str(o.ad_id) ?? str(adsContext?.ad_id),
    ads_context: adsContext,
  };
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export function isFromAd(ref: Referral | null): boolean {
  if (!ref) return false;
  return ref.source === "ADS" || !!ref.ad_id;
}
