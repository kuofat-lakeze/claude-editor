import type { Channel } from "../types.js";

/** 傳給 Graph API /me/messages 的 message 物件 */
export type OutgoingMessage = Record<string, unknown>;

export interface Sender {
  send(channel: Channel, recipientId: string, message: OutgoingMessage): Promise<void>;
  getProfile(
    channel: Channel,
    psid: string,
  ): Promise<{ first_name?: string; last_name?: string; profile_pic?: string } | null>;
}

export function graphBase(channel: Channel, version: string): string {
  const host = channel.platform === "instagram" && channel.instagram_login ? "graph.instagram.com" : "graph.facebook.com";
  return `https://${host}/${version}`;
}

export function createGraphSender(version: string, fetchImpl: typeof fetch = fetch): Sender {
  return {
    async send(channel, recipientId, message) {
      const url = `${graphBase(channel, version)}/me/messages`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${channel.access_token}` },
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: "RESPONSE",
          message,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Graph API ${res.status}: ${body.slice(0, 500)}`);
      }
    },
    async getProfile(channel, psid) {
      const fields = channel.platform === "instagram" ? "name,username,profile_pic" : "first_name,last_name,profile_pic";
      const url = `${graphBase(channel, version)}/${psid}?fields=${fields}`;
      try {
        const res = await fetchImpl(url, { headers: { authorization: `Bearer ${channel.access_token}` } });
        if (!res.ok) return null;
        const j = (await res.json()) as Record<string, string | undefined>;
        if (channel.platform === "instagram") {
          return { first_name: j.name ?? j.username, last_name: j.username ? `@${j.username}` : undefined, profile_pic: j.profile_pic };
        }
        return { first_name: j.first_name, last_name: j.last_name, profile_pic: j.profile_pic };
      } catch {
        return null;
      }
    },
  };
}

/** 測試 / 模擬用：把訊息收集起來不真的送出 */
export function createCaptureSender(): Sender & { sent: { recipientId: string; message: OutgoingMessage }[] } {
  const sent: { recipientId: string; message: OutgoingMessage }[] = [];
  return {
    sent,
    async send(_channel, recipientId, message) {
      sent.push({ recipientId, message });
    },
    async getProfile() {
      return { first_name: "測試", last_name: "用戶" };
    },
  };
}
