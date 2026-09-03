// routes/admins.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const { signToken, requireAuth } = require("../auth");
const { getBranding, setSetting } = require("../settings");

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
  // Keep the shared branding (used by the widget, advisor portal, admin portal top-left) in sync
  if (company_name) setSetting("company_name", company_name);
  if (company_logo) setSetting("company_logo", company_logo);
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.user.id);
  res.json({ admin: safeAdmin(admin) });
});

// Public: branding info the widget/portals use (name + logo), no auth needed to read
router.get("/branding", (req, res) => {
  res.json(getBranding());
});

// Admin OR advisor can update the shared company logo (and admin can also rename the company).
// This is what replaces the default "T / McTimothy Associates" mark at the top-left everywhere,
// as soon as a logo has been uploaded.
router.put("/branding", requireAuth("admin", "advisor"), (req, res) => {
  const { company_name, company_logo } = req.body || {};
  if (req.user.role === "advisor" && company_name) {
    return res.status(403).json({ error: "Only an admin can rename the company. Advisors can update the logo." });
  }
  if (company_name) setSetting("company_name", company_name);
  if (company_logo !== undefined) setSetting("company_logo", company_logo);
  res.json(getBranding());
});

module.exports = router;
