// routes/advisors.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const { signToken, requireAuth } = require("../auth");

const router = express.Router();

function safeAdvisor(a) {
  if (!a) return a;
  const { password_hash, ...rest } = a;
  return rest;
}

// --- Login ---
router.post("/advisors/login", (req, res) => {
  const { email, password } = req.body || {};
  const advisor = db.prepare("SELECT * FROM advisors WHERE email = ?").get((email || "").trim());
  if (!advisor || !bcrypt.compareSync(password || "", advisor.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = signToken(advisor, "advisor");
  res.json({ token, advisor: safeAdvisor(advisor) });
});

// --- Self profile ---
router.get("/advisors/me", requireAuth("advisor"), (req, res) => {
  const advisor = db.prepare("SELECT * FROM advisors WHERE id = ?").get(req.user.id);
  res.json({ advisor: safeAdvisor(advisor) });
});

router.put("/advisors/me", requireAuth("advisor"), (req, res) => {
  const { name, address, phone, staff_id, profile_pic } = req.body || {};
  db.prepare(
    `UPDATE advisors SET name = COALESCE(?, name), address = COALESCE(?, address),
     phone = COALESCE(?, phone), staff_id = COALESCE(?, staff_id), profile_pic = COALESCE(?, profile_pic)
     WHERE id = ?`
  ).run(name, address, phone, staff_id, profile_pic, req.user.id);
  const advisor = db.prepare("SELECT * FROM advisors WHERE id = ?").get(req.user.id);
  res.json({ advisor: safeAdvisor(advisor) });
});

// --- Go active / offline (advisor toggles availability) ---
router.post("/advisors/me/status", requireAuth("advisor"), (req, res) => {
  const { status } = req.body || {}; // 'active' | 'offline'
  if (!["active", "offline"].includes(status)) {
    return res.status(400).json({ error: "status must be 'active' or 'offline'" });
  }
  const current = db.prepare("SELECT * FROM advisors WHERE id = ?").get(req.user.id);
  if (current.status === "busy" && status === "offline") {
    return res.status(409).json({ error: "Finish your current chat before going offline" });
  }
  db.prepare("UPDATE advisors SET status = ? WHERE id = ?").run(status, req.user.id);

  req.app.locals.io.to("admins").emit("advisor_status_changed", {
    advisorId: req.user.id,
    status,
  });

  const { tryAssignAdvisor } = require("./chat");
  if (status === "active") {
    const nextWaiting = db
      .prepare("SELECT id FROM chats WHERE status = 'waiting' ORDER BY queue_requested_at ASC LIMIT 1")
      .get();
    if (nextWaiting) tryAssignAdvisor(req.app.locals.io, nextWaiting.id);
  }
  res.json({ ok: true, status });
});

// --- Queue: chats waiting or ringing, so an idle advisor can pull one ---
router.get("/advisors/me/queue", requireAuth("advisor"), (req, res) => {
  const rows = db
    .prepare(
      `SELECT chats.id AS chat_id, chats.status, chats.queue_requested_at, visitors.full_name, visitors.company_name
       FROM chats JOIN visitors ON visitors.id = chats.visitor_id
       WHERE chats.status IN ('waiting','ringing') ORDER BY chats.queue_requested_at ASC`
    )
    .all();
  res.json({ queue: rows });
});

// --- Advisor's own active chat + history of past chats ---
router.get("/advisors/me/chats", requireAuth("advisor"), (req, res) => {
  const active = db.prepare("SELECT * FROM chats WHERE advisor_id = ? AND status = 'active'").get(req.user.id);
  const history = db
    .prepare(
      `SELECT chats.*, visitors.full_name, visitors.company_name FROM chats
       JOIN visitors ON visitors.id = chats.visitor_id
       WHERE chats.advisor_id = ? AND chats.status = 'closed' ORDER BY chats.ended_at DESC LIMIT 50`
    )
    .all(req.user.id);
  res.json({ active, history });
});

// --- Advisor's complaint log history ---
router.get("/advisors/me/logs", requireAuth("advisor"), (req, res) => {
  const logs = db
    .prepare(
      `SELECT complaint_logs.*, visitors.full_name, visitors.company_name FROM complaint_logs
       JOIN visitors ON visitors.id = complaint_logs.visitor_id
       WHERE complaint_logs.advisor_id = ? ORDER BY complaint_logs.created_at DESC`
    )
    .all(req.user.id);
  res.json({ logs });
});

// --- Advisor's own appraisals / warnings ---
router.get("/advisors/me/appraisals", requireAuth("advisor"), (req, res) => {
  const rows = db
    .prepare("SELECT * FROM appraisals WHERE advisor_id = ? ORDER BY created_at DESC")
    .all(req.user.id);
  res.json({ appraisals: rows });
});

// ============== ADMIN: manage advisors ==============
router.get("/admin/advisors", requireAuth("admin"), (req, res) => {
  const rows = db.prepare("SELECT * FROM advisors ORDER BY created_at DESC").all();
  res.json({ advisors: rows.map(safeAdvisor) });
});

router.post("/admin/advisors", requireAuth("admin"), (req, res) => {
  const { name, email, password, staff_id, phone, address } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "name, email, password are required" });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare(
        `INSERT INTO advisors (name, email, password_hash, staff_id, phone, address) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(name, email.trim(), hash, staff_id || null, phone || null, address || null);
    res.json({ advisor: safeAdvisor(db.prepare("SELECT * FROM advisors WHERE id = ?").get(info.lastInsertRowid)) });
  } catch (e) {
    res.status(409).json({ error: "An advisor with that email already exists" });
  }
});

router.put("/admin/advisors/:id", requireAuth("admin"), (req, res) => {
  const { name, email, staff_id, phone, address, password } = req.body || {};
  db.prepare(
    `UPDATE advisors SET name = COALESCE(?, name), email = COALESCE(?, email), staff_id = COALESCE(?, staff_id),
     phone = COALESCE(?, phone), address = COALESCE(?, address) WHERE id = ?`
  ).run(name, email, staff_id, phone, address, req.params.id);
  if (password) {
    db.prepare("UPDATE advisors SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), req.params.id);
  }
  const advisor = db.prepare("SELECT * FROM advisors WHERE id = ?").get(req.params.id);
  res.json({ advisor: safeAdvisor(advisor) });
});

router.delete("/admin/advisors/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM advisors WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --- Admin issues appraisal or warning ---
router.post("/admin/advisors/:id/appraisals", requireAuth("admin"), (req, res) => {
  const { type, message } = req.body || {}; // type: 'appraisal' | 'warning'
  if (!["appraisal", "warning"].includes(type) || !message) {
    return res.status(400).json({ error: "type ('appraisal'|'warning') and message are required" });
  }
  db.prepare(
    "INSERT INTO appraisals (advisor_id, admin_id, type, message) VALUES (?, ?, ?, ?)"
  ).run(req.params.id, req.user.id, type, message);
  const rows = db.prepare("SELECT * FROM appraisals WHERE advisor_id = ? ORDER BY created_at DESC").all(req.params.id);
  res.json({ appraisals: rows });
});

module.exports = router;
