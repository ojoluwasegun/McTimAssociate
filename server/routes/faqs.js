// routes/faqs.js
const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/faqs", (req, res) => {
  res.json({ faqs: db.prepare("SELECT * FROM faqs ORDER BY category, id").all() });
});

// Every FAQ is mirrored into Quick Answers (linked by faq_id) so the widget's quick-question
// buttons and the bot's knowledge base never drift apart - see routes/misc.js for the reverse sync.
router.post("/admin/faqs", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });
  const info = db
    .prepare("INSERT INTO faqs (category, question, answer) VALUES (?, ?, ?)")
    .run(category || "General", question, answer);
  db.prepare("INSERT INTO quick_answers (category, question, answer, faq_id) VALUES (?, ?, ?, ?)").run(
    category || "General",
    question,
    answer,
    info.lastInsertRowid
  );
  res.json({ faq: db.prepare("SELECT * FROM faqs WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/faqs/:id", requireAuth("admin"), (req, res) => {
  const { category, question, answer } = req.body || {};
  db.prepare(
    `UPDATE faqs SET category = COALESCE(?, category), question = COALESCE(?, question),
     answer = COALESCE(?, answer), updated_at = datetime('now') WHERE id = ?`
  ).run(category, question, answer, req.params.id);

  const linked = db.prepare("SELECT id FROM quick_answers WHERE faq_id = ?").get(req.params.id);
  if (linked) {
    db.prepare(
      `UPDATE quick_answers SET category = COALESCE(?, category), question = COALESCE(?, question),
       answer = COALESCE(?, answer) WHERE faq_id = ?`
    ).run(category, question, answer, req.params.id);
  } else {
    const faq = db.prepare("SELECT * FROM faqs WHERE id = ?").get(req.params.id);
    if (faq) {
      db.prepare("INSERT INTO quick_answers (category, question, answer, faq_id) VALUES (?, ?, ?, ?)").run(
        faq.category,
        faq.question,
        faq.answer,
        faq.id
      );
    }
  }
  res.json({ faq: db.prepare("SELECT * FROM faqs WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/faqs/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM quick_answers WHERE faq_id = ?").run(req.params.id);
  db.prepare("DELETE FROM faqs WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
