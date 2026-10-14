import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Automation, Channel, Contact, Step } from "./types.js";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  instagram_login INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  platform TEXT NOT NULL DEFAULT 'any',
  channel_id INTEGER,
  trigger_type TEXT NOT NULL,
  trigger_value TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  triggered_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  psid TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  profile_pic TEXT,
  source_ad_id TEXT,
  source_ref TEXT,
  source_automation_id INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel_id, psid)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER,
  contact_id INTEGER,
  automation_id INTEGER,
  type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  automation_id INTEGER,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  contact_id INTEGER,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processed_events (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

type Row = Record<string, unknown>;

function rowToAutomation(r: Row): Automation {
  return {
    ...(r as unknown as Automation),
    steps: safeJson<Step[]>(r.steps as string, []),
  };
}
function rowToContact(r: Row): Contact {
  return { ...(r as unknown as Contact), tags: safeJson<string[]>(r.tags as string, []) };
}
function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* ---------- channels ---------- */
export const channels = {
  list(db: DB): Channel[] {
    return db.prepare("SELECT * FROM channels ORDER BY id").all() as unknown as Channel[];
  },
  get(db: DB, id: number): Channel | undefined {
    return db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as unknown as Channel | undefined;
  },
  byExternalId(db: DB, externalId: string): Channel | undefined {
    return db.prepare("SELECT * FROM channels WHERE external_id = ?").get(externalId) as unknown as
      | Channel
      | undefined;
  },
  upsert(db: DB, c: Omit<Channel, "id" | "created_at">): Channel {
    db.prepare(
      `INSERT INTO channels (platform, external_id, name, access_token, instagram_login)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(external_id) DO UPDATE SET
         platform = excluded.platform, name = excluded.name,
         access_token = excluded.access_token, instagram_login = excluded.instagram_login`,
    ).run(c.platform, c.external_id, c.name, c.access_token, c.instagram_login ? 1 : 0);
    return channels.byExternalId(db, c.external_id)!;
  },
  remove(db: DB, id: number) {
    db.prepare("DELETE FROM channels WHERE id = ?").run(id);
  },
};

/* ---------- automations ---------- */
export type AutomationInput = Omit<Automation, "id" | "triggered_count" | "created_at" | "updated_at">;

export const automations = {
  list(db: DB): Automation[] {
    return (db.prepare("SELECT * FROM automations ORDER BY priority DESC, id DESC").all() as Row[]).map(
      rowToAutomation,
    );
  },
  listEnabled(db: DB): Automation[] {
    return (
      db.prepare("SELECT * FROM automations WHERE enabled = 1 ORDER BY priority DESC, id DESC").all() as Row[]
    ).map(rowToAutomation);
  },
  get(db: DB, id: number): Automation | undefined {
    const r = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToAutomation(r) : undefined;
  },
  create(db: DB, a: AutomationInput): Automation {
    const res = db
      .prepare(
        `INSERT INTO automations (name, enabled, priority, platform, channel_id, trigger_type, trigger_value, steps)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.name,
        a.enabled ? 1 : 0,
        a.priority,
        a.platform,
        a.channel_id,
        a.trigger_type,
        a.trigger_value,
        JSON.stringify(a.steps),
      );
    return automations.get(db, Number(res.lastInsertRowid))!;
  },
  update(db: DB, id: number, a: AutomationInput): Automation | undefined {
    db.prepare(
      `UPDATE automations SET name = ?, enabled = ?, priority = ?, platform = ?, channel_id = ?,
         trigger_type = ?, trigger_value = ?, steps = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      a.name,
      a.enabled ? 1 : 0,
      a.priority,
      a.platform,
      a.channel_id,
      a.trigger_type,
      a.trigger_value,
      JSON.stringify(a.steps),
      id,
    );
    return automations.get(db, id);
  },
  remove(db: DB, id: number) {
    db.prepare("DELETE FROM automations WHERE id = ?").run(id);
  },
  bumpTriggered(db: DB, id: number) {
    db.prepare("UPDATE automations SET triggered_count = triggered_count + 1 WHERE id = ?").run(id);
  },
};

/* ---------- contacts ---------- */
export const contacts = {
  list(db: DB, limit = 200): Contact[] {
    return (db.prepare("SELECT * FROM contacts ORDER BY last_seen DESC LIMIT ?").all(limit) as Row[]).map(
      rowToContact,
    );
  },
  get(db: DB, id: number): Contact | undefined {
    const r = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToContact(r) : undefined;
  },
  find(db: DB, channelId: number, psid: string): Contact | undefined {
    const r = db.prepare("SELECT * FROM contacts WHERE channel_id = ? AND psid = ?").get(channelId, psid) as
      | Row
      | undefined;
    return r ? rowToContact(r) : undefined;
  },
  /** 找到或建立聯絡人，並更新 last_seen */
  touch(db: DB, channelId: number, platform: string, psid: string): { contact: Contact; isNew: boolean } {
    const existing = contacts.find(db, channelId, psid);
    if (existing) {
      db.prepare("UPDATE contacts SET last_seen = datetime('now') WHERE id = ?").run(existing.id);
      return { contact: existing, isNew: false };
    }
    db.prepare("INSERT INTO contacts (channel_id, platform, psid) VALUES (?, ?, ?)").run(channelId, platform, psid);
    return { contact: contacts.find(db, channelId, psid)!, isNew: true };
  },
  setProfile(db: DB, id: number, p: { first_name?: string; last_name?: string; profile_pic?: string }) {
    db.prepare(
      `UPDATE contacts SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
         profile_pic = COALESCE(?, profile_pic) WHERE id = ?`,
    ).run(p.first_name ?? null, p.last_name ?? null, p.profile_pic ?? null, id);
  },
  setSource(db: DB, id: number, s: { ad_id: string | null; ref: string | null; automation_id: number | null }) {
    db.prepare(
      `UPDATE contacts SET source_ad_id = COALESCE(source_ad_id, ?), source_ref = COALESCE(source_ref, ?),
         source_automation_id = COALESCE(source_automation_id, ?) WHERE id = ?`,
    ).run(s.ad_id, s.ref, s.automation_id, id);
  },
  addTag(db: DB, id: number, tag: string) {
    const c = contacts.get(db, id);
    if (!c) return;
    if (c.tags.includes(tag)) return;
    db.prepare("UPDATE contacts SET tags = ? WHERE id = ?").run(JSON.stringify([...c.tags, tag]), id);
  },
  remove(db: DB, id: number) {
    db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  },
};

/* ---------- events ---------- */
export interface EventRow {
  id: number;
  channel_id: number | null;
  contact_id: number | null;
  automation_id: number | null;
  type: string;
  summary: string;
  payload: string | null;
  created_at: string;
}
export const events = {
  log(
    db: DB,
    e: { channel_id?: number | null; contact_id?: number | null; automation_id?: number | null; type: string; summary: string; payload?: unknown },
  ) {
    db.prepare(
      "INSERT INTO events (channel_id, contact_id, automation_id, type, summary, payload) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      e.channel_id ?? null,
      e.contact_id ?? null,
      e.automation_id ?? null,
      e.type,
      e.summary,
      e.payload === undefined ? null : JSON.stringify(e.payload),
    );
  },
  list(db: DB, limit = 200): EventRow[] {
    return db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as unknown as EventRow[];
  },
  forContact(db: DB, contactId: number, limit = 100): EventRow[] {
    return db
      .prepare("SELECT * FROM events WHERE contact_id = ? ORDER BY id DESC LIMIT ?")
      .all(contactId, limit) as unknown as EventRow[];
  },
  /** 以 (sender, timestamp, kind) 去重，避免 Meta 重送同一事件時回覆兩次 */
  markProcessed(db: DB, key: string): boolean {
    try {
      db.prepare("INSERT INTO processed_events (key) VALUES (?)").run(key);
      db.prepare("DELETE FROM processed_events WHERE created_at < datetime('now', '-1 day')").run();
      return true;
    } catch {
      return false;
    }
  },
};

/* ---------- links ---------- */
export interface LinkRow {
  id: number;
  slug: string;
  url: string;
  automation_id: number | null;
  clicks: number;
  created_at: string;
}
export const links = {
  list(db: DB): LinkRow[] {
    return db.prepare("SELECT * FROM links ORDER BY id DESC").all() as unknown as LinkRow[];
  },
  bySlug(db: DB, slug: string): LinkRow | undefined {
    return db.prepare("SELECT * FROM links WHERE slug = ?").get(slug) as unknown as LinkRow | undefined;
  },
  /** 同一個自動化 + 同一個目的網址只建立一個追蹤連結 */
  ensure(db: DB, url: string, automationId: number | null, slug: string): LinkRow {
    const existing = db
      .prepare("SELECT * FROM links WHERE url = ? AND automation_id IS ?")
      .get(url, automationId) as unknown as LinkRow | undefined;
    if (existing) return existing;
    db.prepare("INSERT INTO links (slug, url, automation_id) VALUES (?, ?, ?)").run(slug, url, automationId);
    return links.bySlug(db, slug)!;
  },
  recordClick(db: DB, linkId: number, contactId: number | null, userAgent: string | null) {
    db.prepare("UPDATE links SET clicks = clicks + 1 WHERE id = ?").run(linkId);
    db.prepare("INSERT INTO link_clicks (link_id, contact_id, user_agent) VALUES (?, ?, ?)").run(
      linkId,
      contactId,
      userAgent,
    );
  },
};

export function stats(db: DB) {
  const one = (sql: string, ...args: unknown[]) =>
    Number((db.prepare(sql).get(...(args as never[])) as Row).n ?? 0);
  return {
    contacts: one("SELECT COUNT(*) n FROM contacts"),
    contacts_from_ads: one("SELECT COUNT(*) n FROM contacts WHERE source_ad_id IS NOT NULL OR source_ref IS NOT NULL"),
    contacts_today: one("SELECT COUNT(*) n FROM contacts WHERE first_seen >= date('now')"),
    automations: one("SELECT COUNT(*) n FROM automations WHERE enabled = 1"),
    triggered: one("SELECT COALESCE(SUM(triggered_count),0) n FROM automations"),
    link_clicks: one("SELECT COALESCE(SUM(clicks),0) n FROM links"),
    events_today: one("SELECT COUNT(*) n FROM events WHERE created_at >= date('now')"),
  };
}
