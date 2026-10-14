import { createHmac, timingSafeEqual } from "node:crypto";

/** 驗證 Meta Webhook 的 X-Hub-Signature-256 */
export function verifySignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

export function signBody(appSecret: string, rawBody: Buffer | string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
}
