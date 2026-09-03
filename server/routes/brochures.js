// routes/brochures.js
const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

router.get("/brochures", (req, res) => {
  res.json({ brochures: db.prepare("SELECT * FROM brochures ORDER BY id DESC").all() });
});

router.post("/admin/brochures", requireAuth("admin"), (req, res) => {
  const { title, description, price, pdf_link } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });
  const info = db
    .prepare("INSERT INTO brochures (title, description, price, pdf_link) VALUES (?, ?, ?, ?)")
    .run(title, description || "", price || "", pdf_link || "");
  res.json({ brochure: db.prepare("SELECT * FROM brochures WHERE id = ?").get(info.lastInsertRowid) });
});

router.put("/admin/brochures/:id", requireAuth("admin"), (req, res) => {
  const { title, description, price, pdf_link } = req.body || {};
  db.prepare(
    `UPDATE brochures SET title = COALESCE(?, title), description = COALESCE(?, description),
     price = COALESCE(?, price), pdf_link = COALESCE(?, pdf_link), updated_at = datetime('now') WHERE id = ?`
  ).run(title, description, price, pdf_link, req.params.id);
  res.json({ brochure: db.prepare("SELECT * FROM brochures WHERE id = ?").get(req.params.id) });
});

router.delete("/admin/brochures/:id", requireAuth("admin"), (req, res) => {
  db.prepare("DELETE FROM brochures WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
