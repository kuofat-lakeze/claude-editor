import { describe, expect, it } from "vitest";
import { isFromAd, parseWebhook } from "../src/meta/parser.js";

const PAGE_ID = "111222333";

describe("parseWebhook", () => {
  it("解析 messaging_referrals（已對話過的用戶點廣告）", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          time: 1,
          messaging: [
            {
              sender: { id: "USER1" },
              recipient: { id: PAGE_ID },
              timestamp: 1700000000000,
              referral: { ref: "spring", source: "ADS", type: "OPEN_THREAD", ad_id: "AD123" },
            },
          ],
        },
      ],
    };
    const [ev] = parseWebhook(body);
    expect(ev.platform).toBe("messenger");
    expect(ev.kind).toBe("referral");
    expect(ev.referral?.ad_id).toBe("AD123");
    expect(ev.referral?.ref).toBe("spring");
    expect(isFromAd(ev.referral)).toBe(true);
  });

  it("解析 GET_STARTED postback 內的 referral（新用戶點廣告）", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: "USER2" },
              recipient: { id: PAGE_ID },
              timestamp: 2,
              postback: {
                title: "開始使用",
                payload: "GET_STARTED",
                referral: { ref: "x", source: "ADS", type: "OPEN_THREAD", ad_id: "AD999" },
              },
            },
          ],
        },
      ],
    };
    const [ev] = parseWebhook(body);
    expect(ev.kind).toBe("postback");
    expect(ev.postback_payload).toBe("GET_STARTED");
    expect(ev.referral?.ad_id).toBe("AD999");
  });

  it("解析 message 內的 referral（廣告帶預設訊息）與 Instagram ads_context_data", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          id: "IG1",
          messaging: [
            {
              sender: { id: "IGUSER" },
              recipient: { id: "IG1" },
              timestamp: 3,
              message: {
                mid: "m1",
                text: "我想了解更多",
                referral: {
                  source: "ADS",
                  type: "OPEN_THREAD",
                  ref: "",
                  ads_context_data: { ad_title: "春季特賣", photo_url: "https://x/y.jpg", ad_id: "IGAD1" },
                },
              },
            },
          ],
        },
      ],
    };
    const [ev] = parseWebhook(body);
    expect(ev.platform).toBe("instagram");
    expect(ev.kind).toBe("message");
    expect(ev.text).toBe("我想了解更多");
    expect(ev.referral?.ad_id).toBe("IGAD1");
    expect(ev.referral?.ref).toBeNull();
  });

  it("忽略 echo、read、delivery 事件", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            { sender: { id: PAGE_ID }, recipient: { id: "U" }, timestamp: 1, message: { is_echo: true, text: "hi" } },
            { sender: { id: "U" }, recipient: { id: PAGE_ID }, timestamp: 2, read: { watermark: 1 } },
            { sender: { id: "U" }, recipient: { id: PAGE_ID }, timestamp: 3, delivery: { mids: [] } },
          ],
        },
      ],
    };
    expect(parseWebhook(body)).toHaveLength(0);
  });

  it("quick reply 視為 postback", () => {
    const body = {
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          messaging: [
            {
              sender: { id: "U" },
              recipient: { id: PAGE_ID },
              timestamp: 1,
              message: { text: "價格", quick_reply: { payload: "WANT_PRICE" } },
            },
          ],
        },
      ],
    };
    const [ev] = parseWebhook(body);
    expect(ev.kind).toBe("postback");
    expect(ev.postback_payload).toBe("WANT_PRICE");
  });

  it("非 page / instagram 物件回傳空陣列", () => {
    expect(parseWebhook({ object: "user", entry: [] })).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
});
