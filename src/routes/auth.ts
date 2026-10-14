import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import { Router as makeRouter } from "express";

const COOKIE = "mac_session";
const SESSION_DAYS = 30;

export interface AuthOptions {
  password: string;
  secret: string;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function makeToken(secret: string): string {
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  const payload = String(exp);
  return `${payload}.${sign(secret, payload)}`;
}

function validToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(secret, payload);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.header("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireAuth(opts: AuthOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (validToken(opts.secret, readCookie(req, COOKIE))) return next();
    // 也允許 Bearer 密碼，方便用 curl / 腳本呼叫 API
    const auth = req.header("authorization");
    if (auth?.startsWith("Bearer ") && safeEqual(auth.slice(7), opts.password)) return next();
    res.status(401).json({ error: "未登入" });
  };
}

export function authRouter(opts: AuthOptions): Router {
  const router = makeRouter();
  router.post("/login", (req, res) => {
    const pw = typeof req.body?.password === "string" ? req.body.password : "";
    if (!safeEqual(pw, opts.password)) {
      res.status(401).json({ error: "密碼錯誤" });
      return;
    }
    const token = makeToken(opts.secret);
    const secure = req.secure || req.header("x-forwarded-proto") === "https";
    res.setHeader(
      "set-cookie",
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  router.post("/logout", (_req, res) => {
    res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
    res.json({ ok: true });
  });
  router.get("/me", (req, res) => {
    res.json({ authenticated: validToken(opts.secret, readCookie(req, COOKIE)) });
  });
  return router;
}
