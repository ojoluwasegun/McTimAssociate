// routes/misc.js - proposal requests, quick answers, visitor records, analytics
const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

// ---------- Unanswered questions (things Tim wasn't confident about) ----------
router.get("/admin/unanswered-questions", requireAuth("admin", "advisor"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT uq.*, v.full_name, v.company_name FROM unanswered_questions uq
       LEFT JOIN visitors v ON v.id = uq.visitor_id
       WHERE uq.resolved = 0 ORDER BY uq.created_at DESC`
    )
    .all();
  res.json({ questions: rows });
});

// Answering one turns it straight into an FAQ (which auto-mirrors into Quick Answers)
router.post("/admin/unanswered-questions/:id/answer", requireAuth("admin", "advisor"), (req, res) => {
  const { answer, category } = req.body || {};
  if (!answer) return res.status(400).json({ error: "answer is required" });
  const uq = db.prepare("SELECT * FROM unanswered_questions WHERE id = ?").get(req.params.id);
  if (!uq) return res.status(404).json({ error: "Not found" });

  const faqInfo = db
    .prepare("INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)")
    .run(category || "From client questions", uq.question, answer);
  db.prepare("INSERT INTO quick_answers (category, question, answer, faq_id) VALUES (?, ?, ?, ?)").run(
    category || "From client questions",
    uq.question,
    answer,
    faqInfo.lastInsertRowid
  );
  db.prepare("UPDATE unanswered_questions SET resolved = 1 WHERE id = ?").run(req.params.id);
  res.json({ faq: db.prepare("SELECT * FROM faqs WHERE id = ?").get(faqInfo.lastInsertRowid) });
});

router.delete("/admin/unanswered-questions/:id", requireAuth("admin", "advisor"), (req, res) => {
  db.prepare("UPDATE unanswered_questions SET resolved = 1 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Scheduling calendar(s) ----------
// Public: the active calendar link, used by the widget/bot to offer booking automatically
router.get("/calendars/active", (req, res) => {
  const cal = db.prepare("SELECT * FROM calendars WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get();
  res.json({ calendar: cal || null });
});

router.get("/calendars", requireAuth("admin", "advisor"), (req, res) => {
  res.json({ calendars: db.prepare("SELECT * FROM calendars ORDER BY id DESC").all() });
});

router.post("/admin/calendars", requireAuth("admin", "advisor"), (req, res) => {
  const { name, link, file_url } = req.body || {};
  if (!name || (!link && !file_url)) return res.status(400).json({ error: "name and a link or file are required" });
  const isFirst = db.prepare("SELECT COUNT(*) AS c FROM calendars").get().c === 0;
  const info = db
    .prepare("INSERT INTO calendars (name, link, file_url, is_active) VALUES (?, ?, ?, ?)")
    .run(name, link || null, file_url || null, isFirst ? 1 : 0);
  res.json({ calendar: db.prepare("SELECT * FROM calendars WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/calendars/:id/select", requireAuth("admin", "advisor"), (req, res) => {
  db.prepare("UPDATE calendars SET is_active = 0").run();
  db.prepare("UPDATE calendars SET is_active = 1 WHERE id = ?").run(req.params.id);
  res.json({ calendars: db.prepare("SELECT * FROM calendars ORDER BY id DESC").all() });
});

router.delete("/admin/calendars/:id", requireAuth("admin", "advisor"), (req, res) => {
  db.prepare("DELETE FROM calendars WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

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
  const { status, document_url } = req.body || {};
  db.prepare(
    "UPDATE proposal_requests SET status = COALESCE(?, status), document_url = COALESCE(?, document_url) WHERE id = ?"
  ).run(status, document_url, req.params.id);
  res.json({ proposal: db.prepare("SELECT * FROM proposal_requests WHERE id = ?").get(req.params.id) });
});

// ---------- Quick Answers ("Other Quick Questions") ----------
// These mirror the FAQs (linked by faq_id) so any addition/update on either side stays in
// sync - see routes/faqs.js for the FAQ -> Quick Answer direction.
router.get("/quick-answers", (req, res) => {
  res.json({ quickAnswers: db.prepare("SELECT * FROM quick_answers ORDER BY id DESC").all() });
});

router.post("/admin/quick-answers", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });
  const faqInfo = db
    .prepare("INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)")
    .run(category || "Quick Question", question, answer);
  const info = db
    .prepare("INSERT INTO quick_answers (category, question, answer, faq_id) VALUES (?, ?, ?, ?)")
    .run(category || "Quick Question", question, answer, faqInfo.lastInsertRowid);
  res.json({ quickAnswer: db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/quick-answers/:id", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  const existing = db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(req.params.id);
  db.prepare(
    `UPDATE quick_answers SET category = COALESCE(?, category), question = COALESCE(?, question),
     answer = COALESCE(?, answer) WHERE id = ?`
  ).run(category, question, answer, req.params.id);

  if (existing && existing.faq_id) {
    db.prepare(
      `UPDATE faqs SET category = COALESCE(?, category), question = COALESCE(?, question),
       answer = COALESCE(?, answer), updated_at = datetime('now') WHERE id = ?`
    ).run(category, question, answer, existing.faq_id);
  } else if (existing) {
    const updated = db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(req.params.id);
    const faqInfo = db
      .prepare("INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)")
      .run(updated.category, updated.question, updated.answer);
    db.prepare("UPDATE quick_answers SET faq_id = ? WHERE id = ?").run(faqInfo.lastInsertRowid, req.params.id);
  }
  res.json({ quickAnswer: db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/quick-answers/:id", requireAuth("admin"), (req, res) => {
  const existing = db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(req.params.id);
  db.prepare("DELETE FROM quick_answers WHERE id = ?").run(req.params.id);
  if (existing && existing.faq_id) {
    db.prepare("DELETE FROM faqs WHERE id = ?").run(existing.faq_id);
  }
  res.json({ ok: true });
});

// ---------- Quick Replies (advisor canned professional responses) ----------
router.get("/quick-replies", (req, res) => {
  res.json({ quickReplies: db.prepare("SELECT * FROM quick_replies ORDER BY id ASC").all() });
});

router.post("/admin/quick-replies", requireAuth("admin"), (req, res) => {
  const { label, body } = req.body || {};
  if (!label || !body) return res.status(400).json({ error: "label and body are required" });
  const info = db.prepare("INSERT INTO quick_replies (label, body) VALUES (?, ?)").run(label, body);
  res.json({ quickReply: db.prepare("SELECT * FROM quick_replies WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/quick-replies/:id", requireAuth("admin"), (req, res) => {
  const { label, body } = req.body || {};
  db.prepare("UPDATE quick_replies SET label = COALESCE(?, label), body = COALESCE(?, body) WHERE id = ?").run(
    label,
    body,
    req.params.id
  );
  res.json({ quickReply: db.prepare("SELECT * FROM quick_replies WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/quick-replies/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM quick_replies WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Proposal background templates ----------
router.get("/proposal-templates", requireAuth("admin", "advisor"), (req, res) => {
  res.json({ templates: db.prepare("SELECT * FROM proposal_templates ORDER BY id DESC").all() });
});

router.post("/admin/proposal-templates", requireAuth("admin"), (req, res) => {
  const { name, image_url } = req.body || {};
  if (!name || !image_url) return res.status(400).json({ error: "name and image_url are required" });
  const isFirst = db.prepare("SELECT COUNT(*) AS c FROM proposal_templates").get().c === 0;
  const info = db
    .prepare("INSERT INTO proposal_templates (name, image_url, is_active) VALUES (?, ?, ?)")
    .run(name, image_url, isFirst ? 1 : 0);
  res.json({ template: db.prepare("SELECT * FROM proposal_templates WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/proposal-templates/:id/select", requireAuth("admin"), (req, res) => {
  db.prepare("UPDATE proposal_templates SET is_active = 0").run();
  db.prepare("UPDATE proposal_templates SET is_active = 1 WHERE id = ?").run(req.params.id);
  res.json({ templates: db.prepare("SELECT * FROM proposal_templates ORDER BY id DESC").all() });
});

router.delete("/admin/proposal-templates/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM proposal_templates WHERE id = ?").run(req.params.id);
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

  // Chats attended (i.e. picked up by an advisor) by day of week, Sun..Sat
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayRows = db
    .prepare(
      `SELECT CAST(strftime('%w', COALESCE(started_at, created_at)) AS INTEGER) AS dow, COUNT(*) AS c
       FROM chats WHERE advisor_id IS NOT NULL GROUP BY dow`
    )
    .all();
  const chatsByWeekday = weekdayNames.map((day, dow) => ({
    day,
    count: weekdayRows.find((r) => r.dow === dow)?.c || 0,
  }));

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
