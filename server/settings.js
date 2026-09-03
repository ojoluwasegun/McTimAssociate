// settings.js - tiny helper around the key/value `settings` table
const { db } = require("./db");

function getSetting(key, fallback = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row && row.value != null ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value == null ? "" : value);
}

function getBranding() {
  return {
    company_name: getSetting("company_name", "McTimothy Associates"),
    company_logo: getSetting("company_logo", ""),
  };
}

function getFallbackContact() {
  return {
    email: getSetting("fallback_email", "info@mctimothyassociates.com"),
    phone: getSetting("fallback_phone", "(+234) 703 485 4045 / 07034854045"),
  };
}

module.exports = { getSetting, setSetting, getBranding, getFallbackContact };
