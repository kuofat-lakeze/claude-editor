import { Router } from "express";
import type { DB } from "../db.js";
import { contacts, events, links } from "../db.js";

/** /r/:slug?c=contactId → 記錄點擊後 302 到目的網址 */
export function redirectRouter(db: DB): Router {
  const router = Router();
  router.get("/:slug", (req, res) => {
    const link = links.bySlug(db, String(req.params.slug));
    if (!link) {
      res.status(404).send("連結不存在");
      return;
    }
    const contactId = Number(req.query.c);
    const contact = Number.isInteger(contactId) && contactId > 0 ? contacts.get(db, contactId) : undefined;
    links.recordClick(db, link.id, contact?.id ?? null, req.header("user-agent") ?? null);
    events.log(db, {
      channel_id: contact?.channel_id ?? null,
      contact_id: contact?.id ?? null,
      automation_id: link.automation_id,
      type: "click",
      summary: `點擊連結 → ${link.url}`,
    });
    res.redirect(302, link.url);
  });
  return router;
}
