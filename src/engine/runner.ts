import { randomBytes } from "node:crypto";
import type { Automation, Button, Channel, Contact, Referral, Step } from "../types.js";
import type { DB } from "../db.js";
import { automations, contacts, events, links } from "../db.js";
import type { OutgoingMessage, Sender } from "../meta/sendApi.js";
import { renderTemplate } from "./templates.js";

export interface RunContext {
  db: DB;
  sender: Sender;
  publicUrl: string;
  channel: Channel;
  contact: Contact;
  referral: Referral | null;
  text: string | null;
  /** 模擬模式：不寫入事件記錄、不累計觸發次數 */
  dryRun?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_GOTO_DEPTH = 5;
const MAX_DELAY_SECONDS = 15;

/** 執行一條自動化的所有步驟 */
export async function runAutomation(automation: Automation, ctx: RunContext, depth = 0): Promise<void> {
  const { db, sender, channel, contact } = ctx;
  if (!ctx.dryRun) {
    automations.bumpTriggered(db, automation.id);
    events.log(db, {
      channel_id: channel.id,
      contact_id: contact.id,
      automation_id: automation.id,
      type: "automation",
      summary: `觸發自動化「${automation.name}」`,
    });
  }

  for (const step of automation.steps) {
    try {
      await runStep(step, automation, ctx, depth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!ctx.dryRun) {
        events.log(db, {
          channel_id: channel.id,
          contact_id: contact.id,
          automation_id: automation.id,
          type: "error",
          summary: `步驟 ${step.type} 送出失敗：${msg}`,
          payload: { step },
        });
      }
      throw err;
    }
  }
}

async function runStep(step: Step, automation: Automation, ctx: RunContext, depth: number): Promise<void> {
  const { db, sender, channel, contact } = ctx;
  const tctx = { contact, referral: ctx.referral, text: ctx.text };
  const render = (s: string) => renderTemplate(s, tctx);

  const deliver = async (message: OutgoingMessage, summary: string) => {
    await sender.send(channel, contact.psid, message);
    if (!ctx.dryRun) {
      events.log(db, {
        channel_id: channel.id,
        contact_id: contact.id,
        automation_id: automation.id,
        type: "sent",
        summary,
        payload: message,
      });
    }
  };

  switch (step.type) {
    case "text":
      await deliver({ text: render(step.text) }, `送出文字：${truncate(render(step.text))}`);
      return;

    case "buttons": {
      const buttons = step.buttons.slice(0, 3).map((b) => buildButton(b, automation, ctx));
      await deliver(
        {
          attachment: {
            type: "template",
            payload: { template_type: "button", text: render(step.text), buttons },
          },
        },
        `送出按鈕訊息：${truncate(render(step.text))}`,
      );
      return;
    }

    case "quick_replies":
      await deliver(
        {
          text: render(step.text),
          quick_replies: step.replies.slice(0, 13).map((r) => ({
            content_type: "text",
            title: render(r.title).slice(0, 20),
            payload: r.payload,
          })),
        },
        `送出快速回覆：${truncate(render(step.text))}`,
      );
      return;

    case "image":
      await deliver(
        { attachment: { type: "image", payload: { url: step.url, is_reusable: true } } },
        `送出圖片：${step.url}`,
      );
      return;

    case "delay": {
      const ms = Math.min(Math.max(step.seconds, 0), MAX_DELAY_SECONDS) * 1000;
      if (ms > 0) await (ctx.sleep ?? defaultSleep)(ms);
      return;
    }

    case "tag":
      if (!ctx.dryRun) contacts.addTag(db, contact.id, step.tag);
      return;

    case "goto": {
      if (depth >= MAX_GOTO_DEPTH) return;
      const next = automations.get(db, step.automation_id);
      if (!next || !next.enabled) return;
      await runAutomation(next, ctx, depth + 1);
      return;
    }
  }
}

function buildButton(b: Button, automation: Automation, ctx: RunContext) {
  const tctx = { contact: ctx.contact, referral: ctx.referral, text: ctx.text };
  const title = renderTemplate(b.title, tctx).slice(0, 20);
  if (b.type === "postback") return { type: "postback", title, payload: b.payload };

  let url = renderTemplate(b.url, tctx);
  if (b.track !== false) {
    const link = links.ensure(ctx.db, url, automation.id, randomSlug());
    url = `${ctx.publicUrl}/r/${link.slug}?c=${ctx.contact.id}`;
  }
  return { type: "web_url", title, url };
}

function randomSlug(): string {
  return randomBytes(5).toString("base64url");
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
