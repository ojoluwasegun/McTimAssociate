// index.js - Tim / McTimothy Associates chatbot + portal backend
require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { seedIfEmpty } = require("./db");
seedIfEmpty();

const { SECRET } = require("./auth");
const chatRoutes = require("./routes/chat");
const advisorRoutes = require("./routes/advisors");
const adminRoutes = require("./routes/admins");
const faqRoutes = require("./routes/faqs");
const brochureRoutes = require("./routes/brochures");
const miscRoutes = require("./routes/misc");
const uploadRoutes = require("./routes/uploads");

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim());
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "2mb" }));
app.locals.io = io;

// static frontend + uploaded images (public/ lives inside server/ for Railway's build context)
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", chatRoutes.router);
app.use("/api", advisorRoutes);
app.use("/api", adminRoutes);
app.use("/api", faqRoutes);
app.use("/api", brochureRoutes);
app.use("/api", miscRoutes);
app.use("/api", uploadRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------------- Socket.IO ----------------
io.on("connection", (socket) => {
  // A visitor's widget joins the room for its chat so it gets live updates
  socket.on("join_chat", ({ chatId }) => {
    if (chatId) socket.join(`chat:${chatId}`);
  });

  // An advisor authenticates their socket with their JWT and joins their personal room,
  // so they get "incoming_chat_request" ring events even across multiple tabs/devices
  socket.on("advisor_hello", ({ token }) => {
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload.role === "advisor") {
        socket.join(`advisor:${payload.id}`);
        socket.data.advisorId = payload.id;
      }
    } catch (e) {
      // ignore bad token, socket just won't get ring events
    }
  });

  socket.on("admin_hello", ({ token }) => {
    try {
      const payload = jwt.verify(token, SECRET);
      if (payload.role === "admin") socket.join("admins");
    } catch (e) {
      /* ignore */
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Tim / McTimothy Associates server running on http://localhost:${PORT}`);
  console.log(`Widget:   http://localhost:${PORT}/widget.html`);
  console.log(`Advisor:  http://localhost:${PORT}/advisor.html`);
  console.log(`Admin:    http://localhost:${PORT}/admin.html`);
});
