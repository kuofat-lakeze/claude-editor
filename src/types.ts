export type Platform = "messenger" | "instagram";

export interface Channel {
  id: number;
  platform: Platform;
  /** Messenger: 粉絲專頁 ID；Instagram: IG 專業帳號 ID（Webhook entry.id 會對到這個值） */
  external_id: string;
  name: string;
  access_token: string;
  /** Instagram 若是用「Instagram 登入」取得的 token，要走 graph.instagram.com */
  instagram_login: number;
  created_at: string;
}

export type TriggerType =
  | "ad" // 指定廣告 ID
  | "ref" // 廣告 / m.me 連結上的 ref 參數
  | "any_ad" // 任何從廣告點進來的人
  | "keyword" // 訊息包含關鍵字
  | "postback" // 按鈕 payload
  | "get_started" // 第一次開啟對話（開始使用）
  | "default"; // 都沒命中時的預設回覆

export interface UrlButton {
  type: "url";
  title: string;
  url: string;
  /** 是否經由本系統的追蹤連結轉址（可統計點擊） */
  track?: boolean;
}
export interface PostbackButton {
  type: "postback";
  title: string;
  payload: string;
}
export type Button = UrlButton | PostbackButton;

export type Step =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: Button[] }
  | { type: "quick_replies"; text: string; replies: { title: string; payload: string }[] }
  | { type: "image"; url: string }
  | { type: "delay"; seconds: number }
  | { type: "tag"; tag: string }
  | { type: "goto"; automation_id: number };

export interface Automation {
  id: number;
  name: string;
  enabled: number;
  priority: number;
  platform: Platform | "any";
  channel_id: number | null;
  trigger_type: TriggerType;
  /** ad: 廣告 ID；ref: ref 值；keyword: 以逗號分隔的關鍵字；postback: payload */
  trigger_value: string;
  steps: Step[];
  triggered_count: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  channel_id: number;
  platform: Platform;
  psid: string;
  first_name: string | null;
  last_name: string | null;
  profile_pic: string | null;
  source_ad_id: string | null;
  source_ref: string | null;
  source_automation_id: number | null;
  tags: string[];
  first_seen: string;
  last_seen: string;
}

export interface Referral {
  source: string | null; // ADS / SHORTLINK / MESSENGER_CODE ...
  type: string | null; // OPEN_THREAD ...
  ref: string | null;
  ad_id: string | null;
  ads_context: Record<string, unknown> | null;
}

/** Webhook 事件正規化後的樣子 */
export interface IncomingEvent {
  platform: Platform;
  channel_external_id: string;
  sender_id: string;
  timestamp: number;
  kind: "message" | "postback" | "referral" | "other";
  text: string | null;
  postback_payload: string | null;
  referral: Referral | null;
  /** 原始 messaging 物件，記錄用 */
  raw: unknown;
}
