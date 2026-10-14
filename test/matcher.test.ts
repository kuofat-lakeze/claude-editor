import { describe, expect, it } from "vitest";
import { matchAutomation } from "../src/engine/matcher.js";
import { renderTemplate } from "../src/engine/templates.js";
import type { Automation, IncomingEvent } from "../src/types.js";

let seq = 1;
function auto(partial: Partial<Automation>): Automation {
  return {
    id: seq++,
    name: partial.name ?? `a${seq}`,
    enabled: 1,
    priority: 0,
    platform: "any",
    channel_id: null,
    trigger_type: "default",
    trigger_value: "",
    steps: [{ type: "text", text: "hi" }],
    triggered_count: 0,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}
function ev(partial: Partial<IncomingEvent>): IncomingEvent {
  return {
    platform: "messenger",
    channel_external_id: "P",
    sender_id: "U",
    timestamp: 1,
    kind: "message",
    text: null,
    postback_payload: null,
    referral: null,
    raw: null,
    ...partial,
  };
}
const adRef = (ad_id: string, ref: string | null = null) => ({ source: "ADS", type: "OPEN_THREAD", ad_id, ref, ads_context: null });

describe("matchAutomation", () => {
  const specificAd = auto({ name: "specific", trigger_type: "ad", trigger_value: "AD1, AD2" });
  const refRule = auto({ name: "ref", trigger_type: "ref", trigger_value: "spring" });
  const anyAd = auto({ name: "anyad", trigger_type: "any_ad" });
  const kw = auto({ name: "kw", trigger_type: "keyword", trigger_value: "價格,price" });
  const pb = auto({ name: "pb", trigger_type: "postback", trigger_value: "WANT_PRICE" });
  const gs = auto({ name: "gs", trigger_type: "get_started" });
  const def = auto({ name: "default", trigger_type: "default" });
  const all = [def, gs, pb, kw, anyAd, refRule, specificAd];

  it("指定廣告 ID 優先於任何廣告", () => {
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("AD2") }), all, 1)?.name).toBe("specific");
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("OTHER") }), all, 1)?.name).toBe("anyad");
  });

  it("ref 參數命中（含前綴）", () => {
    const noAnyAd = all.filter((a) => a !== anyAd && a !== specificAd);
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("X", "spring_2026") }), noAnyAd, 1)?.name).toBe("ref");
  });

  it("GET_STARTED 帶廣告 referral 時走廣告規則，不帶時走 get_started", () => {
    expect(matchAutomation(ev({ kind: "postback", postback_payload: "GET_STARTED", referral: adRef("AD1") }), all, 1)?.name).toBe("specific");
    expect(matchAutomation(ev({ kind: "postback", postback_payload: "GET_STARTED" }), all, 1)?.name).toBe("gs");
  });

  it("按鈕 payload 最優先", () => {
    expect(matchAutomation(ev({ kind: "postback", postback_payload: "WANT_PRICE", text: "價格" }), all, 1)?.name).toBe("pb");
  });

  it("關鍵字不分大小寫，其餘走預設", () => {
    expect(matchAutomation(ev({ text: "What is the PRICE?" }), all, 1)?.name).toBe("kw");
    expect(matchAutomation(ev({ text: "哈囉" }), all, 1)?.name).toBe("default");
  });

  it("純 referral 事件沒命中時不會掉到預設回覆", () => {
    const onlyDefault = [def];
    expect(matchAutomation(ev({ kind: "referral", referral: { source: "SHORTLINK", type: "OPEN_THREAD", ad_id: null, ref: "zzz", ads_context: null } }), onlyDefault, 1)).toBeNull();
  });

  it("尊重平台、頻道與啟用狀態", () => {
    const igOnly = auto({ name: "ig", trigger_type: "any_ad", platform: "instagram", priority: 100 });
    const ch2 = auto({ name: "ch2", trigger_type: "any_ad", channel_id: 2, priority: 100 });
    const disabled = auto({ name: "off", trigger_type: "any_ad", enabled: 0, priority: 100 });
    const list = [igOnly, ch2, disabled, anyAd];
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("A") }), list, 1)?.name).toBe("anyad");
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("A"), platform: "instagram" }), list, 1)?.name).toBe("ig");
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("A") }), list, 2)?.name).toBe("ch2");
  });

  it("同層依 priority 決定", () => {
    const low = auto({ name: "low", trigger_type: "any_ad", priority: 1 });
    const high = auto({ name: "high", trigger_type: "any_ad", priority: 5 });
    // listEnabled 會依 priority DESC 排序，這裡模擬排好序的輸入
    expect(matchAutomation(ev({ kind: "referral", referral: adRef("A") }), [high, low], 1)?.name).toBe("high");
  });
});

describe("renderTemplate", () => {
  it("替換變數並給未知名稱空字串", () => {
    const out = renderTemplate("嗨 {{first_name}}，來自 {{ad_id}}/{{ref}} {{nope}}", {
      contact: { first_name: "小明", last_name: "王", psid: "1" },
      referral: adRef("AD1", "r"),
    });
    expect(out).toBe("嗨 小明，來自 AD1/r ");
  });
  it("沒有名字時用「朋友」", () => {
    expect(renderTemplate("{{first_name}}好", { contact: { first_name: null, last_name: null, psid: "1" }, referral: null })).toBe("朋友好");
  });
});
