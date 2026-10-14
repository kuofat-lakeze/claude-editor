import { Router, raw } from "express";
import type { HandlerDeps } from "../engine/handler.js";
import { handleIncomingEvent } from "../engine/handler.js";
import { parseWebhook } from "../meta/parser.js";
import { verifySignature } from "../meta/signature.js";
import { events } from "../db.js";

export interface WebhookOptions extends HandlerDeps {
  verifyToken: string;
  appSecret: string;
}

/** Meta Webhook：GET 驗證、POST 接收事件 */
export function webhookRouter(opts: WebhookOptions): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === opts.verifyToken && typeof challenge === "string") {
      res.status(200).type("text/plain").send(challenge);
      return;
    }
    res.status(403).send("verify token 不符");
  });

  router.post("/", raw({ type: "*/*", limit: "2mb" }), (req, res) => {
    const rawBody = req.body as Buffer;
    if (opts.appSecret) {
      const sig = req.header("x-hub-signature-256");
      if (!verifySignature(opts.appSecret, rawBody, sig)) {
        events.log(opts.db, { type: "warning", summary: "Webhook 簽章驗證失敗，已拒絕（請確認 META_APP_SECRET）" });
        res.status(401).send("invalid signature");
        return;
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).send("bad json");
      return;
    }

    // Meta 要求 20 秒內回 200，所以先回應再非同步處理
    res.status(200).send("EVENT_RECEIVED");

    const incoming = parseWebhook(body);
    void (async () => {
      for (const ev of incoming) {
        try {
          await handleIncomingEvent(ev, opts);
        } catch (err) {
          events.log(opts.db, {
            type: "error",
            summary: `處理事件時發生錯誤：${err instanceof Error ? err.message : String(err)}`,
            payload: ev.raw,
          });
        }
      }
    })();
  });

  return router;
}
