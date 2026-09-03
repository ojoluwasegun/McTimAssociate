// routes/chat.js - visitor gate, Tim (bot) Q&A, advisor queue/ringing, live messaging
const express = require("express");
const { db } = require("../db");
const { askTim } = require("../openai");
const { requireAuth } = require("../auth");
const { getFallbackContact } = require("../settings");

const router = express.Router();

const RING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const ringTimers = new Map(); // chatId -> Timeout

function firstNameOf(fullName) {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "there";
  return trimmed.includes(" ") ? trimmed.split(/\s+/)[0] : trimmed;
}

function isWeekend() {
  const day = new Date().getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function advisorCounts() {
  const rows = db.prepare("SELECT status, COUNT(*) AS c FROM advisors GROUP BY status").all();
  const counts = { active: 0, busy: 0, offline: 0 };
  rows.forEach((r) => (counts[r.status] = r.c));
  return counts;
}

function queuePosition(chatId) {
  const waiting = db
    .prepare("SELECT id FROM chats WHERE status IN ('waiting','ringing') ORDER BY queue_requested_at ASC")
    .all();
  const idx = waiting.findIndex((c) => c.id === chatId);
  return idx === -1 ? waiting.length : idx + 1;
}

function saveMessage(chatId, senderType, senderName, body) {
  const info = db
    .prepare(`INSERT INTO messages (chat_id, sender_type, sender_name, body) VALUES (?, ?, ?, ?)`)
    .run(chatId, senderType, senderName || null, body);
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
}

// Attempt to assign an idle advisor to a chat. Returns 'ringing' | 'waiting' | 'no_advisors'
function tryAssignAdvisor(io, chatId) {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId);
  if (!chat || !["waiting", "ringing", "bot"].includes(chat.status)) return chat ? chat.status : null;

  const counts = advisorCounts();
  const idleAdvisor = db.prepare("SELECT * FROM advisors WHERE status = 'active' ORDER BY RANDOM() LIMIT 1").get();

  if (idleAdvisor) {
    db.prepare(
      "UPDATE chats SET status = 'ringing', queue_requested_at = COALESCE(queue_requested_at, datetime('now')) WHERE id = ?"
    ).run(chatId);
    io.to(`advisor:${idleAdvisor.id}`).emit("incoming_chat_request", {
      chatId,
      visitor: db.prepare("SELECT * FROM visitors WHERE id = ?").get(chat.visitor_id),
      timeoutMs: RING_TIMEOUT_MS,
    });
    io.to(`chat:${chatId}`).emit("chat_status", {
      status: "ringing",
      message: "Connecting you to an advisor now...",
      countdownMs: RING_TIMEOUT_MS,
    });

    clearTimeout(ringTimers.get(chatId));
    const timer = setTimeout(() => {
      const fresh = db.prepare("SELECT * FROM chats WHERE id = ?").get(chatId);
      if (fresh && fresh.status === "ringing") {
        // no one accepted in time - fall back to queue and try again
        db.prepare("UPDATE chats SET status = 'waiting' WHERE id = ?").run(chatId);
        io.to(`chat:${chatId}`).emit("chat_status", {
          status: "waiting",
          message: "Still finding you an advisor - you're next in line.",
          queuePosition: queuePosition(chatId),
        });
        tryAssignAdvisor(io, chatId);
      }
    }, RING_TIMEOUT_MS);
    ringTimers.set(chatId, timer);
    return "ringing";
  }

  if (counts.busy > 0) {
    db.prepare(
      "UPDATE chats SET status = 'waiting', queue_requested_at = COALESCE(queue_requested_at, datetime('now')) WHERE id = ?"
    ).run(chatId);
    io.to(`chat:${chatId}`).emit("chat_status", {
      status: "waiting",
      message: "All our advisors are currently helping other clients.",
      queuePosition: queuePosition(chatId),
    });
    return "waiting";
  }

  // no advisors online at all
  const sla = isWeekend()
    ? "within 24 hours (weekend response time)"
    : "within 2 hours";
  const { email, phone } = getFallbackContact();
  const fallback = `It looks like none of our advisors are online right now. For a faster response, please reach out via email at ${email}, or call/WhatsApp us on ${phone} - we reply ${sla}. Would you like me to leave your details for an advisor to follow up?`;
  saveMessage(chatId, "bot", "Tim", fallback);
  io.to(`chat:${chatId}`).emit("chat_status", { status: "bot", message: fallback });
  io.to(`chat:${chatId}`).emit("new_message", { chat_id: chatId, sender_type: "bot", sender_name: "Tim", body: fallback });
  return "no_advisors";
}

// --- Visitor gate: create/register a visitor + start a chat ---
router.post("/visitors", (req, res) => {
  const { full_name, company_name, email, course } = req.body || {};
  if (!full_name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }
  const first_name = firstNameOf(full_name);
  const info = db
    .prepare(
      `INSERT INTO visitors (first_name, full_name, company_name, email, course) VALUES (?, ?, ?, ?, ?)`
    )
    .run(first_name, full_name.trim(), company_name || null, email.trim(), course || null);
  const visitor = db.prepare("SELECT * FROM visitors WHERE id = ?").get(info.lastInsertRowid);

  const chatInfo = db.prepare(`INSERT INTO chats (visitor_id, status) VALUES (?, 'bot')`).run(visitor.id);
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(chatInfo.lastInsertRowid);

  const greeting = `Hi ${first_name}! I'm Tim, the AI Associate from McTimothy Associates. I can help you with training brochures & pricing, corporate proposal requests, course schedules, or quick questions. How can I help you today?`;
  const msg = saveMessage(chat.id, "bot", "Tim", greeting);

  res.json({ visitor, chat, greeting: msg });
});

// --- Get chat state (history + status) ---
router.get("/chats/:id", (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const messages = db
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC")
    .all(chat.id);
  const visitor = db.prepare("SELECT * FROM visitors WHERE id = ?").get(chat.visitor_id);
  res.json({ chat, messages, visitor, queuePosition: queuePosition(chat.id) });
});

function getActiveCalendar() {
  return db.prepare("SELECT * FROM calendars WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get();
}

const CALENDAR_KEYWORDS = /\b(book a call|schedule a call|book a meeting|schedule a meeting|calendar|availability|available slot|book an appointment|schedule an appointment|when (can|are) you (free|available))\b/i;

// --- Visitor asks Tim (bot) a question ---
router.post("/chats/:id/ask", async (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const { question } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: "Question is required" });

  saveMessage(chat.id, "client", null, question);
  req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", {
    chat_id: chat.id,
    sender_type: "client",
    body: question,
  });

  // If a human advisor already owns this chat, route the message to them instead of the bot
  if (chat.status === "active" && chat.advisor_id) {
    req.app.locals.io.to(`advisor:${chat.advisor_id}`).emit("client_message", {
      chatId: chat.id,
      body: question,
    });
    return res.json({ routedToAdvisor: true });
  }

  // Deterministic handling for scheduling/calendar requests, so a link is always given
  // reliably rather than depending on the LLM to remember to mention one.
  if (CALENDAR_KEYWORDS.test(question)) {
    const cal = getActiveCalendar();
    const link = cal ? cal.link || cal.file_url : null;
    const answer = link
      ? `You can view our availability and book a slot here: ${link}`
      : `I'd love to help you book a call - let me connect you with an advisor who can share available times.`;
    const saved = saveMessage(chat.id, "bot", "Tim", answer);
    req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", {
      chat_id: chat.id,
      sender_type: "bot",
      sender_name: "Tim",
      body: answer,
    });
    return res.json({ message: saved, lowConfidence: false });
  }

  const faqs = db.prepare("SELECT question, answer FROM faqs").all();
  const faqContext = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");
  const priorMessages = db
    .prepare("SELECT sender_type, body FROM messages WHERE chat_id = ? ORDER BY id ASC")
    .all(chat.id)
    .slice(-10, -1)
    .map((m) => ({ role: m.sender_type === "client" ? "user" : "assistant", content: m.body }));

  const { answer, lowConfidence } = await askTim({ faqContext, history: priorMessages, question });
  const saved = saveMessage(chat.id, "bot", "Tim", answer);
  req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", {
    chat_id: chat.id,
    sender_type: "bot",
    sender_name: "Tim",
    body: answer,
  });

  // Log it so admin/advisor can review and turn it into an FAQ (which auto-mirrors to Quick Answers)
  if (lowConfidence) {
    db.prepare("INSERT INTO unanswered_questions (chat_id, visitor_id, question) VALUES (?, ?, ?)").run(
      chat.id,
      chat.visitor_id,
      question
    );
  }

  res.json({ message: saved, lowConfidence });
});

// --- Visitor submits corporate proposal details (from the "Get a proposal" quick action) ---
router.post("/chats/:id/proposal-request", (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const visitor = db.prepare("SELECT * FROM visitors WHERE id = ?").get(chat.visitor_id);
  const { training_topic, staff_count, preferred_date } = req.body || {};

  const info = db
    .prepare(
      `INSERT INTO proposal_requests (visitor_id, chat_id, company_name, training_topic, staff_count, preferred_date)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      chat.visitor_id,
      chat.id,
      visitor?.company_name || "",
      training_topic || "",
      staff_count || "",
      preferred_date || ""
    );

  const note = `Proposal request submitted - Topic: ${training_topic || "-"}, Staff: ${staff_count || "-"}, Preferred date: ${preferred_date || "-"}. Our team will follow up shortly.`;
  const saved = saveMessage(chat.id, "bot", "Tim", note);
  req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", {
    chat_id: chat.id,
    sender_type: "bot",
    sender_name: "Tim",
    body: note,
  });

  const proposal = db.prepare("SELECT * FROM proposal_requests WHERE id = ?").get(info.lastInsertRowid);
  res.json({ proposal, message: saved });
});

// --- Visitor requests a human advisor ---
router.post("/chats/:id/request-advisor", (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  db.prepare("UPDATE chats SET queue_requested_at = COALESCE(queue_requested_at, datetime('now')) WHERE id = ?").run(chat.id);
  const outcome = tryAssignAdvisor(req.app.locals.io, chat.id);
  res.json({ outcome, queuePosition: queuePosition(chat.id) });
});

// --- Advisor accepts a ringing/waiting chat ---
router.post("/chats/:id/accept", requireAuth("advisor"), (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  if (!["ringing", "waiting"].includes(chat.status)) {
    return res.status(409).json({ error: "This chat has already been picked up." });
  }
  clearTimeout(ringTimers.get(chat.id));
  ringTimers.delete(chat.id);

  db.prepare(
    "UPDATE chats SET status = 'active', advisor_id = ?, started_at = datetime('now') WHERE id = ?"
  ).run(req.user.id, chat.id);
  db.prepare("UPDATE advisors SET status = 'busy', active_chat_id = ? WHERE id = ?").run(chat.id, req.user.id);
  req.app.locals.io.to("admins").emit("advisor_status_changed", { advisorId: req.user.id, status: "busy" });

  const advisor = db.prepare("SELECT id, name FROM advisors WHERE id = ?").get(req.user.id);
  const note = `${advisor.name} has joined the chat.`;
  saveMessage(chat.id, "system", null, note);

  req.app.locals.io.to(`chat:${chat.id}`).emit("chat_status", { status: "active", advisor, message: note });
  req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", { chat_id: chat.id, sender_type: "system", body: note });
  // let other advisors know this one is no longer up for grabs
  req.app.locals.io.emit("chat_claimed", { chatId: chat.id, advisorId: req.user.id });

  res.json({ ok: true, chat: db.prepare("SELECT * FROM chats WHERE id = ?").get(chat.id) });
});

// --- Advisor sends a message ---
router.post("/chats/:id/messages", requireAuth("advisor"), (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  if (chat.advisor_id !== req.user.id) return res.status(403).json({ error: "Not your chat" });
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: "Message body required" });

  const msg = saveMessage(chat.id, "advisor", req.user.name, body);
  req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", {
    chat_id: chat.id,
    sender_type: "advisor",
    sender_name: req.user.name,
    body,
  });
  res.json({ message: msg });
});

// --- Advisor sends a resource link (receipt / calendar) ---
router.post("/chats/:id/resources", requireAuth("advisor"), (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  const { kind, link } = req.body || {};
  if (!kind || !link) return res.status(400).json({ error: "kind and link are required" });

  db.prepare(
    "INSERT INTO resources (visitor_id, chat_id, kind, link, sent_by) VALUES (?, ?, ?, ?, ?)"
  ).run(chat.visitor_id, chat.id, kind, link, req.user.name);

  const label = kind === "receipt" ? "receipt" : kind === "calendar" ? "calendar invite" : kind === "proposal" ? "proposal document" : kind;
  const body = `Here is your ${label} link: ${link}`;
  const msg = saveMessage(chat.id, "advisor", req.user.name, body);
  req.app.locals.io.to(`chat:${chat.id}`).emit("new_message", {
    chat_id: chat.id,
    sender_type: "advisor",
    sender_name: req.user.name,
    body,
  });
  res.json({ message: msg });
});

// --- Advisor logs a complaint / closes chat, optionally flags for follow-up ---
router.post("/chats/:id/close", requireAuth("advisor"), (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  if (chat.advisor_id !== req.user.id) return res.status(403).json({ error: "Not your chat" });

  const { issue, resolution, flagged, flag_reason } = req.body || {};

  db.prepare("UPDATE chats SET status = 'closed', ended_at = datetime('now'), resolution = ? WHERE id = ?").run(
    resolution || null,
    chat.id
  );
  db.prepare("UPDATE advisors SET status = 'active', active_chat_id = NULL WHERE id = ?").run(req.user.id);
  req.app.locals.io.to("admins").emit("advisor_status_changed", { advisorId: req.user.id, status: "active" });

  db.prepare(
    `INSERT INTO complaint_logs (chat_id, advisor_id, visitor_id, issue, resolution, flagged, flag_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chat.id,
    req.user.id,
    chat.visitor_id,
    issue || "General chat",
    resolution || null,
    flagged ? 1 : 0,
    flagged ? flag_reason || null : null
  );

  const note = "This chat has ended. Thank you for contacting McTimothy Associates!";
  saveMessage(chat.id, "system", null, note);
  req.app.locals.io.to(`chat:${chat.id}`).emit("chat_status", { status: "closed", message: note });

  // free advisor may now pull the next queued chat
  const nextWaiting = db
    .prepare("SELECT id FROM chats WHERE status = 'waiting' ORDER BY queue_requested_at ASC LIMIT 1")
    .get();
  if (nextWaiting) tryAssignAdvisor(req.app.locals.io, nextWaiting.id);

  res.json({ ok: true });
});

// --- Visitor reloaded, closed the tab, or gave up waiting before an advisor joined.
// Called via navigator.sendBeacon on page unload/hide, so it must work with no auth
// and without depending on a JSON body being parsed. ---
router.post("/chats/:id/end-wait", (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat || chat.status === "closed") return res.json({ ok: true });

  clearTimeout(ringTimers.get(chat.id));
  ringTimers.delete(chat.id);

  const wasActive = chat.status === "active" && chat.advisor_id;
  const note = wasActive
    ? "The client left the website - this chat has been ended."
    : "The client ended their wait and left before connecting with an advisor.";

  db.prepare(
    "UPDATE chats SET status = 'closed', ended_at = datetime('now'), resolution = ? WHERE id = ?"
  ).run(note, chat.id);
  saveMessage(chat.id, "system", null, note);

  const io = req.app.locals.io;
  io.to(`chat:${chat.id}`).emit("chat_status", { status: "closed", message: note });
  // let an advisor whose ring modal / dashboard is still showing this chat know it's gone
  io.emit("chat_claimed", { chatId: chat.id, advisorId: chat.advisor_id || null });

  if (wasActive) {
    db.prepare("UPDATE advisors SET status = 'active', active_chat_id = NULL WHERE id = ?").run(chat.advisor_id);
    const nextWaiting = db
      .prepare("SELECT id FROM chats WHERE status = 'waiting' ORDER BY queue_requested_at ASC LIMIT 1")
      .get();
    if (nextWaiting) tryAssignAdvisor(io, nextWaiting.id);
  }

  res.json({ ok: true });
});

// --- Visitor asks to speak to a human explicitly (used by "not helpful" button) ---
router.post("/chats/:id/escalate", (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  db.prepare("UPDATE chats SET queue_requested_at = COALESCE(queue_requested_at, datetime('now')) WHERE id = ?").run(chat.id);
  const outcome = tryAssignAdvisor(req.app.locals.io, chat.id);
  res.json({ outcome, queuePosition: queuePosition(chat.id) });
});

module.exports = { router, tryAssignAdvisor, queuePosition, saveMessage };
