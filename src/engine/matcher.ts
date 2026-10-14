import type { Automation, IncomingEvent } from "../types.js";
import { isFromAd } from "../meta/parser.js";

/**
 * 決定一個事件要跑哪一條自動化。
 *
 * 優先順序（同一層再比 priority 大者優先、再比新建者優先）：
 *  1. postback payload 完全相符（按鈕 / 快速回覆）
 *  2. 廣告 ID 相符
 *  3. ref 參數相符
 *  4. 任何廣告點進來（any_ad）
 *  5. 開始使用（get_started）
 *  6. 關鍵字（訊息包含任一關鍵字，不分大小寫）
 *  7. 預設回覆（default）—只對「訊息」與「開始使用」事件生效，不回應純 referral 以外的雜訊
 */
export function matchAutomation(
  event: IncomingEvent,
  candidates: Automation[],
  channelId: number | null,
): Automation | null {
  const applicable = candidates.filter((a) => {
    if (!a.enabled) return false;
    if (a.platform !== "any" && a.platform !== event.platform) return false;
    if (a.channel_id !== null && a.channel_id !== channelId) return false;
    return true;
  });

  const pick = (type: Automation["trigger_type"], pred: (a: Automation) => boolean = () => true) =>
    applicable.find((a) => a.trigger_type === type && pred(a)) ?? null;

  const ref = event.referral;
  const payload = event.postback_payload;

  if (payload && payload !== "GET_STARTED") {
    const hit = pick("postback", (a) => a.trigger_value.trim() === payload);
    if (hit) return hit;
  }

  if (ref?.ad_id) {
    const hit = pick("ad", (a) => splitList(a.trigger_value).includes(ref.ad_id!));
    if (hit) return hit;
  }

  if (ref?.ref) {
    const hit = pick("ref", (a) => splitList(a.trigger_value).some((v) => v === ref.ref || ref.ref!.startsWith(v)));
    if (hit) return hit;
  }

  if (isFromAd(ref)) {
    const hit = pick("any_ad");
    if (hit) return hit;
  }

  if (payload === "GET_STARTED") {
    const hit = pick("get_started");
    if (hit) return hit;
  }

  if (event.text) {
    const text = event.text.toLowerCase();
    const hit = pick("keyword", (a) =>
      splitList(a.trigger_value).some((kw) => kw.length > 0 && text.includes(kw.toLowerCase())),
    );
    if (hit) return hit;
  }

  if (event.kind === "message" || payload === "GET_STARTED") {
    const hit = pick("default");
    if (hit) return hit;
  }

  return null;
}

export function splitList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
