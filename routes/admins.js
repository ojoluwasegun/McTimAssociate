// routes/admins.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const { signToken, requireAuth } = require("../auth");

const router = express.Router();

function safeAdmin(a) {
  if (!a) return a;
  const { password_hash, ...rest } = a;
  return rest;
}

router.post("/admins/login", (req, res) => {
  const { email, password } = req.body || {};
  const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get((email || "").trim());
  if (!admin || !bcrypt.compareSync(password || "", admin.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = signToken(admin, "admin");
  res.json({ token, admin: safeAdmin(admin) });
});

router.get("/admins/me", requireAuth("admin"), (req, res) => {
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.user.id);
  res.json({ admin: safeAdmin(admin) });
});

router.put("/admins/me", requireAuth("admin"), (req, res) => {
  const { name, company_name, company_logo, address, phone, profile_pic, password } = req.body || {};
  db.prepare(
    `UPDATE admins SET name = COALESCE(?, name), company_name = COALESCE(?, company_name),
     company_logo = COALESCE(?, company_logo), address = COALESCE(?, address),
     phone = COALESCE(?, phone), profile_pic = COALESCE(?, profile_pic) WHERE id = ?`
  ).run(name, company_name, company_logo, address, phone, profile_pic, req.user.id);
  if (password) {
    db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), req.user.id);
  }
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.user.id);
  res.json({ admin: safeAdmin(admin) });
});

// Public: branding info the client widget can use (name + logo), no auth needed
router.get("/branding", (req, res) => {
  const admin = db.prepare("SELECT company_name, company_logo FROM admins ORDER BY id ASC LIMIT 1").get();
  res.json({
    company_name: admin?.company_name || "McTimothy Associates",
    company_logo: admin?.company_logo || "",
  });
});

module.exports = router;
