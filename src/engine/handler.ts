import type { IncomingEvent } from "../types.js";
import type { DB } from "../db.js";
import { automations, channels, contacts, events } from "../db.js";
import type { Sender } from "../meta/sendApi.js";
import { isFromAd } from "../meta/parser.js";
import { matchAutomation } from "./matcher.js";
import { runAutomation } from "./runner.js";

export interface HandlerDeps {
  db: DB;
  sender: Sender;
  publicUrl: string;
}

/** 處理一個正規化後的 Webhook 事件：建立聯絡人 → 比對規則 → 執行 */
export async function handleIncomingEvent(event: IncomingEvent, deps: HandlerDeps): Promise<void> {
  const { db, sender, publicUrl } = deps;

  const channel = channels.byExternalId(db, event.channel_external_id);
  if (!channel) {
    events.log(db, {
      type: "warning",
      summary: `收到未設定頻道的事件（${event.platform} ${event.channel_external_id}），請到「頻道」頁新增`,
      payload: event.raw,
    });
    return;
  }

  // 去重：Meta 可能重送同一事件
  const dedupeKey = `${channel.id}:${event.sender_id}:${event.timestamp}:${event.kind}`;
  if (!events.markProcessed(db, dedupeKey)) return;

  const { contact, isNew } = contacts.touch(db, channel.id, event.platform, event.sender_id);

  if (isNew || !contact.first_name) {
    const profile = await sender.getProfile(channel, event.sender_id);
    if (profile) contacts.setProfile(db, contact.id, profile);
  }

  const fromAd = isFromAd(event.referral);
  events.log(db, {
    channel_id: channel.id,
    contact_id: contact.id,
    type: event.kind,
    summary: describeEvent(event, fromAd),
    payload: event.raw,
  });

  const match = matchAutomation(event, automations.listEnabled(db), channel.id);

  if (event.referral && (fromAd || event.referral.ref)) {
    contacts.setSource(db, contact.id, {
      ad_id: event.referral.ad_id,
      ref: event.referral.ref,
      automation_id: match?.id ?? null,
    });
  }

  if (!match) return;

  const fresh = contacts.get(db, contact.id) ?? contact;
  try {
    await runAutomation(match, {
      db,
      sender,
      publicUrl,
      channel,
      contact: fresh,
      referral: event.referral,
      text: event.text,
    });
  } catch {
    // 錯誤已由 runner 記錄到事件，這裡不再往外丟，避免 Meta 重送整包 webhook
  }
}

function describeEvent(e: IncomingEvent, fromAd: boolean): string {
  const parts: string[] = [];
  if (fromAd) parts.push(`從廣告進入${e.referral?.ad_id ? `（ad_id ${e.referral.ad_id}）` : ""}`);
  else if (e.referral?.ref) parts.push(`帶 ref=${e.referral.ref} 進入`);
  if (e.kind === "message" && e.text) parts.push(`訊息：${e.text.slice(0, 80)}`);
  else if (e.kind === "message") parts.push("收到非文字訊息");
  else if (e.kind === "postback") parts.push(`按下按鈕：${e.text ?? e.postback_payload ?? ""}`);
  else if (e.kind === "referral" && parts.length === 0) parts.push("收到 referral 事件");
  return parts.join("，") || "收到事件";
}
