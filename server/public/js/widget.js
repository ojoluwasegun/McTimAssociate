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
  const widgetTitle = document.getElementById("widgetTitle");
  const widgetAvatar = document.getElementById("widgetAvatar");
  const msgInput = document.getElementById("msgInput");
  const sendBtn = document.getElementById("sendBtn");
  const gateSubmit = document.getElementById("gateSubmit");
  const gateError = document.getElementById("gateError");
  const talkToAdvisorBtn = document.getElementById("talkToAdvisorBtn");
  const quickActions = document.getElementById("quickActions");
  const dynamicQuickActions = document.getElementById("dynamicQuickActions");

  let chat = null; // { id, ... }
  let visitor = null;
  let socket = null;
  let countdownTimer = null;
  let mode = "bot"; // bot | ringing | waiting | active | closed
  let companyName = "McTimothy Associates";

  launcher.addEventListener("click", () => {
    panel.classList.toggle("hidden");
  });
  closeBtn.addEventListener("click", () => {
    panel.classList.add("hidden");
    // If the visitor closes the widget while still waiting/ringing for an advisor,
    // treat that as ending their wait rather than leaving it hanging in the queue.
    if (chat && (mode === "waiting" || mode === "ringing")) endWait();
  });

  // ---------------- Branding (logo replaces the "T" mark once uploaded) ----------------
  fetch(API + "/api/branding")
    .then((r) => r.json())
    .then((b) => {
      companyName = b.company_name || companyName;
      widgetTitle.textContent = `Tim - ${companyName}`;
      document.title = `${companyName} - Chat with Tim`;
      if (b.company_logo) {
        widgetAvatar.innerHTML = `<img src="${b.company_logo}" alt="${escapeHtml(companyName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      }
    })
    .catch(() => {});

  // ---------------- Quick questions (kept in sync with FAQs by the admin) ----------------
  fetch(API + "/api/quick-answers")
    .then((r) => r.json())
    .then((d) => {
      (d.quickAnswers || []).slice(0, 3).forEach((qa) => {
        const btn = document.createElement("button");
        btn.textContent = qa.question.length > 28 ? qa.question.slice(0, 26) + "…" : qa.question;
        btn.title = qa.question;
        btn.addEventListener("click", () => sendUserText(qa.question));
        dynamicQuickActions.appendChild(btn);
      });
    })
    .catch(() => {});

  // ---------------- End the wait / leave the chat cleanly ----------------
  function endWait() {
    if (!chat) return;
    const url = `${API}/api/chats/${chat.id}/end-wait`;
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([], { type: "application/json" }));
      } else {
        fetch(url, { method: "POST", keepalive: true });
      }
    } catch (e) {
      /* best effort */
    }
  }
  // Reload / navigate away / close tab -> let the server know so the chat doesn't sit
  // in the queue or tie up an advisor forever.
  window.addEventListener("pagehide", () => {
    if (chat && mode !== "closed") endWait();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && chat && (mode === "waiting" || mode === "ringing")) endWait();
  });

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
      // Client typing should never be blocked while a conversation is live - only once
      // it has actually ended. Keep the input visible and enabled through bot / waiting /
      // ringing / active so the client is never restricted from typing.
      msgInput.disabled = false;
      sendBtn.disabled = false;
      // Once a human is involved (or being connected), the quick-question chips are no
      // longer useful and were eating into the visible chat space - hide them and let the
      // message list use the full height instead.
      quickActions.classList.toggle("hidden", s.status !== "bot");

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
        setStatusBar("An advisor has joined the chat - you can keep typing", false);
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

  const getProposalBtn = document.getElementById("getProposalBtn");
  const proposalForm = document.getElementById("proposalForm");
  getProposalBtn.addEventListener("click", () => proposalForm.classList.remove("hidden"));
  document.getElementById("pfCancel").addEventListener("click", () => proposalForm.classList.add("hidden"));
  document.getElementById("pfSubmit").addEventListener("click", async () => {
    if (!chat) return;
    const training_topic = document.getElementById("pfTopic").value.trim();
    const staff_count = document.getElementById("pfStaff").value.trim();
    const preferred_date = document.getElementById("pfDate").value;
    try {
      await api(`/api/chats/${chat.id}/proposal-request`, {
        method: "POST",
        body: JSON.stringify({ training_topic, staff_count, preferred_date }),
      });
      proposalForm.classList.add("hidden");
      document.getElementById("pfTopic").value = "";
      document.getElementById("pfStaff").value = "";
      document.getElementById("pfDate").value = "";
    } catch (e) {
      /* ignore */
    }
  });

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
