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
  const { status } = req.body || {};
  db.prepare("UPDATE proposal_requests SET status = COALESCE(?, status) WHERE id = ?").run(status, req.params.id);
  res.json({ proposal: db.prepare("SELECT * FROM proposal_requests WHERE id = ?").get(req.params.id) });
});

// ---------- Quick Answers ("Other Quick Questions") ----------
router.get("/quick-answers", (req, res) => {
  res.json({ quickAnswers: db.prepare("SELECT * FROM quick_answers ORDER BY id DESC").all() });
});

router.post("/admin/quick-answers", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });
  const info = db
    .prepare("INSERT INTO quick_answers (category, question, answer) VALUES (?, ?, ?)")
    .run(category || "Quick Question", question, answer);
  res.json({ quickAnswer: db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/quick-answers/:id", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  db.prepare(
    `UPDATE quick_answers SET category = COALESCE(?, category), question = COALESCE(?, question),
     answer = COALESCE(?, answer) WHERE id = ?`
  ).run(category, question, answer, req.params.id);
  res.json({ quickAnswer: db.prepare("SELECT * FROM quick_answers WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/quick-answers/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM quick_answers WHERE id = ?").run(req.params.id);
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

  res.json({
    totalChats,
    closedChats,
    botOnlyChats,
    totalVisitors,
    flaggedOpen,
    proposalsCount,
    perAdvisor,
    chatsByDay,
  });
});

module.exports = router;
