// routes/faqs.js
const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/faqs", (req, res) => {
  res.json({ faqs: db.prepare("SELECT * FROM faqs ORDER BY category, id").all() });
});

router.post("/admin/faqs", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });
  const info = db
    .prepare("INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)")
    .run(category || "General", question, answer);
  res.json({ faq: db.prepare("SELECT * FROM faqs WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/faqs/:id", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  db.prepare(
    `UPDATE faqs SET category = COALESCE(?, category), question = COALESCE(?, question),
     answer = COALESCE(?, answer), updated_at = datetime('now') WHERE id = ?`
  ).run(category, question, answer, req.params.id);
  res.json({ faq: db.prepare("SELECT * FROM faqs WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/faqs/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM faqs WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
