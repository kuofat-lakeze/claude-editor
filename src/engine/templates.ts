import type { Contact, Referral } from "../types.js";

export interface TemplateContext {
  contact: Pick<Contact, "first_name" | "last_name" | "psid">;
  referral: Referral | null;
  text?: string | null;
}

/** 支援 {{first_name}} {{last_name}} {{full_name}} {{ad_id}} {{ref}} {{psid}} {{message}} */
export function renderTemplate(input: string, ctx: TemplateContext): string {
  const first = ctx.contact.first_name ?? "";
  const last = ctx.contact.last_name ?? "";
  const vars: Record<string, string> = {
    first_name: first || "朋友",
    last_name: last,
    full_name: [first, last].filter(Boolean).join(" ") || "朋友",
    ad_id: ctx.referral?.ad_id ?? "",
    ref: ctx.referral?.ref ?? "",
    psid: ctx.contact.psid,
    message: ctx.text ?? "",
  };
  return input.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => (key in vars ? vars[key] : ""));
}
