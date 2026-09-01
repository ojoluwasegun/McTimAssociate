(function () {
  const API = ""; // same origin
  const launcher = document.getElementById("launcher");
  const panel = document.getElementById("panel");
  const closeBtn = document.getElementById("closeBtn");
  const gate = document.getElementById("gate");
  const chatArea = document.getElementById("chatArea");
  const messagesEl = document.getElementById("messages");
  const statusBar = document.getElementById("statusBar");
  const widgetSub = document.getElementById("widgetSub");
  const msgInput = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const gateSubmit = document.getElementById("gateSubmit");
  const gateError = document.getElementById("gateError");
  const talkToAdvisorBtn = document.getElementById("talkToAdvisorBtn");

  let chat = null; // { id, ... }
  let visitor = null;
  let socket = null;
  let countdownTimer = null;
  let mode = "bot"; // bot | ringing | waiting | active | closed

  launcher.addEventListener("click", () => {
    panel.classList.toggle("hidden");
  });
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function addMessage({ sender_type, sender_name, body }) {
    const div = document.createElement("div");
    if (sender_type === "system") {
      div.className = "msg system";
      div.textContent = body;
    } else {
      div.className = `msg ${sender_type}`;
      const label = sender_type === "client" ? "You" : sender_name || (sender_type === "bot" ? "Tim" : "Advisor");
      div.innerHTML = `<span class="sender">${escapeHtml(label)}</span>${escapeHtml(body)}`;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatusBar(text, showCountdown) {
    if (!text) {
      statusBar.classList.add("hidden");
      return;
    }
    statusBar.classList.remove("hidden");
    statusBar.innerHTML = `<span>${escapeHtml(text)}</span>` + (showCountdown ? `<span id="countdownNum"></span>` : "");
  }

  function startCountdown(ms) {
    clearInterval(countdownTimer);
    let remaining = Math.floor(ms / 1000);
    const el = () => document.getElementById("countdownNum");
    const tick = () => {
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2, "0");
      if (el()) el().textContent = `${m}:${s}`;
      if (remaining <= 0) clearInterval(countdownTimer);
      remaining--;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  async function api(path, opts) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
    return res.json();
  }

  gateSubmit.addEventListener("click", async () => {
    const full_name = document.getElementById("gateName").value.trim();
    const company_name = document.getElementById("gateCompany").value.trim();
    const email = document.getElementById("gateEmail").value.trim();
    const course = document.getElementById("gateCourse").value.trim();
    gateError.style.display = "none";
    if (!full_name || !email) {
      gateError.textContent = "Name and email are required.";
      gateError.style.display = "block";
      return;
    }
    gateSubmit.disabled = true;
    gateSubmit.textContent = "Starting chat...";
    try {
      const data = await api("/api/visitors", {
        method: "POST",
        body: JSON.stringify({ full_name, company_name, email, course }),
      });
      visitor = data.visitor;
      chat = data.chat;
      gate.classList.add("hidden");
      chatArea.classList.remove("hidden");
      addMessage(data.greeting);
      connectSocket();
    } catch (e) {
      gateError.textContent = e.message;
      gateError.style.display = "block";
    } finally {
      gateSubmit.disabled = false;
      gateSubmit.textContent = "Start chat";
    }
  });

  function connectSocket() {
    socket = io();
    socket.emit("join_chat", { chatId: chat.id });
    socket.on("new_message", (m) => {
      if (m.chat_id !== chat.id) return;
      if (m.sender_type === "client") return; // already rendered locally
      addMessage(m);
    });
    socket.on("chat_status", (s) => {
      mode = s.status;
      if (s.status === "ringing") {
        widgetSub.textContent = "Connecting you to an advisor...";
        setStatusBar(s.message, true);
        startCountdown(s.countdownMs || 120000);
      } else if (s.status === "waiting") {
        widgetSub.textContent = "In queue for an advisor";
        clearInterval(countdownTimer);
        setStatusBar(`${s.message} (position ${s.queuePosition || 1} in line)`, false);
      } else if (s.status === "active") {
        widgetSub.textContent = `Chatting with ${s.advisor?.name || "an advisor"}`;
        clearInterval(countdownTimer);
        setStatusBar("An advisor has joined the chat", false);
        setTimeout(() => setStatusBar(null), 4000);
      } else if (s.status === "closed") {
        widgetSub.textContent = "Chat ended";
        clearInterval(countdownTimer);
        setStatusBar(s.message, false);
        msgInput.disabled = true;
        sendBtn.disabled = true;
      } else if (s.status === "bot") {
        widgetSub.textContent = "AI Associate - usually replies instantly";
        clearInterval(countdownTimer);
        setStatusBar(null);
      }
    });
  }

  async function sendUserText(text) {
    if (!chat || !text.trim()) return;
    addMessage({ sender_type: "client", body: text });
    msgInput.value = "";
    try {
      const data = await api(`/api/chats/${chat.id}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: text }),
      });
      if (data.message && !data.routedToAdvisor) {
        // already broadcast via socket, but render immediately in case socket is slow
      }
      if (data.lowConfidence) {
        addNotHelpfulPrompt();
      }
    } catch (e) {
      addMessage({ sender_type: "system", body: "Sorry, something went wrong sending that message." });
    }
  }

  function addNotHelpfulPrompt() {
    const btn = document.createElement("button");
    btn.className = "not-helpful";
    btn.textContent = "Not the answer you needed? Talk to a human advisor -->";
    btn.onclick = () => requestAdvisor();
    messagesEl.appendChild(btn);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function requestAdvisor() {
    if (!chat) return;
    try {
      const data = await api(`/api/chats/${chat.id}/request-advisor`, { method: "POST" });
      if (data.outcome === "waiting") {
        setStatusBar(`Looking for the next available advisor (position ${data.queuePosition} in line)`, false);
      }
    } catch (e) {
      /* ignore */
    }
  }

  talkToAdvisorBtn.addEventListener("click", requestAdvisor);

  document.querySelectorAll(".quick-actions button[data-q]").forEach((btn) => {
    btn.addEventListener("click", () => sendUserText(btn.getAttribute("data-q")));
  });

  sendBtn.addEventListener("click", () => sendUserText(msgInput.value));
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendUserText(msgInput.value);
    }
  });
})();
