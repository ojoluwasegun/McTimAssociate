// auth.js - JWT helpers + middleware for advisor/admin protected routes
const jwt = require("jsonwebtoken");
require("dotenv").config();

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signToken(user, role) {
  return jwt.sign({ id: user.id, role, name: user.name, email: user.email }, SECRET, {
    expiresIn: "12h",
  });
}

function requireAuth(...roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    try {
      const payload = jwt.verify(token, SECRET);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "Not authorized for this action" });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

module.exports = { signToken, requireAuth, SECRET };
