// routes/uploads.js - profile picture / company logo uploads
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { requireAuth } = require("../auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${req.user.role}-${req.user.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  },
});

// Requires the caller to already be logged in as advisor or admin
router.post("/uploads/image", requireAuth("advisor", "admin"), upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Documents (existing proposal PDFs/Word docs advisors want to send/attach), plus images
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `doc-${req.user.role}-${req.user.id}-${Date.now()}${ext}`);
  },
});
const uploadDoc = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = /^image\//.test(file.mimetype) || /pdf|msword|officedocument|calendar/.test(file.mimetype) || ext === ".ics";
    if (!ok) return cb(new Error("Only PDF, Word, calendar (.ics), or image files are allowed"));
    cb(null, true);
  },
});
router.post("/uploads/document", requireAuth("advisor", "admin"), uploadDoc.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

module.exports = router;
