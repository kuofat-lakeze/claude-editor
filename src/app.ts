import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DB } from "./db.js";
import type { Sender } from "./meta/sendApi.js";
import { webhookRouter } from "./routes/webhook.js";
import { redirectRouter } from "./routes/redirect.js";
import { authRouter, requireAuth } from "./routes/auth.js";
import { apiRouter, HttpError } from "./routes/api.js";

export interface AppOptions {
  db: DB;
  sender: Sender;
  publicUrl: string;
  graphVersion: string;
  verifyToken: string;
  appSecret: string;
  adminPassword: string;
  sessionSecret: string;
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  // Webhook 要拿原始 body 驗簽章，所以放在 json parser 之前
  app.use(
    "/webhook",
    webhookRouter({
      db: opts.db,
      sender: opts.sender,
      publicUrl: opts.publicUrl,
      verifyToken: opts.verifyToken,
      appSecret: opts.appSecret,
    }),
  );

  app.use("/r", redirectRouter(opts.db));

  app.use(express.json({ limit: "1mb" }));

  const auth = { password: opts.adminPassword, secret: opts.sessionSecret };
  app.use("/api/auth", authRouter(auth));
  app.use(
    "/api",
    requireAuth(auth),
    apiRouter({
      db: opts.db,
      sender: opts.sender,
      publicUrl: opts.publicUrl,
      graphVersion: opts.graphVersion,
      verifyToken: opts.verifyToken,
      appSecretConfigured: opts.appSecret.length > 0,
    }),
  );

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
  app.use(express.static(publicDir));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    res.status(500).json({ error: message });
  });

  return app;
}
