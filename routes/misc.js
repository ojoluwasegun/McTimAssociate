// routes/misc.js - proposal requests, quick answers, visitor records, analytics
const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

// ---------- Corporate Proposal Requests ----------
router.post("/proposals", (req, res) => {
  const { visitor_id, company_name, training_topic, staff_count, preferred_date } = req.body || {};
  const info = db
    .prepare(
      `INSERT INTO proposal_requests (visitor_id, company_name, training_topic, staff_count, preferred_date)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(visitor_id || null, company_name || "", training_topic || "", staff_count || "", preferred_date || "");
  res.json({ proposal: db.prepare("SELECT * FROM proposal_requests WHERE id = ?").get(info.lastInsertRowid) });
});

router.get("/admin/proposals", requireAuth("admin", "advisor"), (req, res) => {
  res.json({ proposals: db.prepare("SELECT * FROM proposal_requests ORDER BY created_at DESC").all() });
});

router.put("/admin/proposals/:id", requireAuth("admin", "advisor"), (req, res) => {
  const { status, document_url, template_id } = req.body || {};
  db.prepare(
    `UPDATE proposal_requests SET status = COALESCE(?, status), document_url = COALESCE(?, document_url),
     template_id = COALESCE(?, template_id) WHERE id = ?`
  ).run(status, document_url, template_id, req.params.id);
  res.json({ proposal: db.prepare("SELECT * FROM proposal_requests WHERE id = ?").get(req.params.id) });
});

// ---------- Proposal background templates ----------
// Admin uploads background images; advisors/admin can then assign one to a proposal request
// so the proposal card is displayed with that image as a background only (no text baked in).
router.get("/proposal-templates", requireAuth("admin", "advisor"), (req, res) => {
  res.json({ templates: db.prepare("SELECT * FROM proposal_templates ORDER BY created_at DESC").all() });
});

router.post("/admin/proposal-templates", requireAuth("admin"), (req, res) => {
  const { name, image_url } = req.body || {};
  if (!name || !image_url) return res.status(400).json({ error: "name and image_url are required" });
  const info = db.prepare("INSERT INTO proposal_templates (name, image_url) VALUES (?, ?)").run(name, image_url);
  res.json({ template: db.prepare("SELECT * FROM proposal_templates WHERE id = ?").get(info.lastInsertRowid) });
});

router.delete("/admin/proposal-templates/:id", requireAuth("admin"), (req, res) => {
  db.prepare("UPDATE proposal_requests SET template_id = NULL WHERE template_id = ?").run(req.params.id);
  db.prepare("DELETE FROM proposal_templates WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Quick Answers ----------
// Quick Answers and FAQs are intentionally the same underlying data (the `faqs` table),
// so anything added or edited from either admin screen shows up in both.
router.get("/quick-answers", (req, res) => {
  res.json({ quickAnswers: db.prepare("SELECT * FROM faqs ORDER BY category, id").all() });
});

router.post("/admin/quick-answers", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });
  const info = db
    .prepare("INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)")
    .run(category || "Quick Answer", question, answer);
  res.json({ quickAnswer: db.prepare("SELECT * FROM faqs WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/quick-answers/:id", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  db.prepare(
    `UPDATE faqs SET category = COALESCE(?, category), question = COALESCE(?, question),
     answer = COALESCE(?, answer), updated_at = datetime('now') WHERE id = ?`
  ).run(category, question, answer, req.params.id);
  res.json({ quickAnswer: db.prepare("SELECT * FROM faqs WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/quick-answers/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM faqs WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Visitor records ----------
router.get("/admin/visitors", requireAuth("admin", "advisor"), (req, res) => {
  const rows = db.prepare("SELECT * FROM visitors ORDER BY created_at DESC").all();
  res.json({ visitors: rows });
});

// ---------- Complaint logs / flags (admin-wide view) ----------
router.get("/admin/logs", requireAuth("admin"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT complaint_logs.*, advisors.name AS advisor_name, visitors.full_name, visitors.company_name
       FROM complaint_logs
       LEFT JOIN advisors ON advisors.id = complaint_logs.advisor_id
       LEFT JOIN visitors ON visitors.id = complaint_logs.visitor_id
       ORDER BY complaint_logs.created_at DESC`
    )
    .all();
  res.json({ logs: rows });
});

router.put("/admin/logs/:id/resolve", requireAuth("admin"), (req, res) => {
  db.prepare("UPDATE complaint_logs SET flag_status = 'resolved' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Analytics ----------
router.get("/admin/analytics", requireAuth("admin"), (req, res) => {
  const totalChats = db.prepare("SELECT COUNT(*) AS c FROM chats").get().c;
  const closedChats = db.prepare("SELECT COUNT(*) AS c FROM chats WHERE status = 'closed'").get().c;
  const botOnlyChats = db
    .prepare("SELECT COUNT(*) AS c FROM chats WHERE advisor_id IS NULL AND status != 'waiting' AND status != 'ringing'")
    .get().c;
  const totalVisitors = db.prepare("SELECT COUNT(*) AS c FROM visitors").get().c;
  const flaggedOpen = db.prepare("SELECT COUNT(*) AS c FROM complaint_logs WHERE flagged = 1 AND flag_status = 'open'").get().c;
  const proposalsCount = db.prepare("SELECT COUNT(*) AS c FROM proposal_requests").get().c;

  const perAdvisor = db
    .prepare(
      `SELECT advisors.id, advisors.name,
              COUNT(chats.id) AS chats_handled,
              SUM(CASE WHEN chats.status = 'closed' THEN 1 ELSE 0 END) AS chats_closed
       FROM advisors
       LEFT JOIN chats ON chats.advisor_id = advisors.id
       GROUP BY advisors.id
       ORDER BY chats_handled DESC`
    )
    .all();

  const chatsByDay = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS c FROM chats
       GROUP BY date(created_at) ORDER BY day DESC LIMIT 14`
    )
    .all();

  // Cases attended (closed by an advisor) grouped by day of week, Sun(0)..Sat(6)
  const weekdayRows = db
    .prepare(
      `SELECT strftime('%w', created_at) AS dow, COUNT(*) AS c FROM chats
       WHERE status = 'closed' GROUP BY dow`
    )
    .all();
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const chatsByWeekday = weekdayNames.map((name, idx) => {
    const row = weekdayRows.find((r) => Number(r.dow) === idx);
    return { day: name, c: row ? row.c : 0 };
  });

  res.json({
    totalChats,
    closedChats,
    botOnlyChats,
    totalVisitors,
    flaggedOpen,
    proposalsCount,
    perAdvisor,
    chatsByDay,
    chatsByWeekday,
  });
});

module.exports = router;
