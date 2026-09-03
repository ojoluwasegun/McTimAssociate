(function () {
  let token = localStorage.getItem("mc_advisor_token") || null;
  let advisor = null;
  let socket = null;
  let currentChatId = null;
  let ringTimer = null;
  let pendingRing = null; // { chatId, visitor }

  const loginView = document.getElementById("loginView");
  const appShell = document.getElementById("appShell");
  const content = document.getElementById("content");
  const viewTitle = document.getElementById("viewTitle");
  const queueBadge = document.getElementById("queueBadge");
  const statusBtn = document.getElementById("statusBtn");
  const advisorNameLabel = document.getElementById("advisorNameLabel");
  const ringModal = document.getElementById("ringModal");
  const brandBadge = document.querySelector(".sidebar .brand .badge");
  const brandNameEl = document.querySelector(".sidebar .brand-name strong");

  let quickReplies = [];
  let audioCtx = null;
  let ringInterval = null;

  // Browsers require a user gesture before audio can play - grab one on the first click
  // anywhere so the ring tone is guaranteed to be able to play later.
  document.addEventListener(
    "click",
    () => {
      if (!audioCtx) {
        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {}
      }
    },
    { once: true }
  );

  function playRingBeep(atTime) {
    if (!audioCtx || !ringMasterGain) return;
    const now = atTime != null ? atTime : audioCtx.currentTime;
    [0, 0.28].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      osc.connect(gain).connect(ringMasterGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.24);
    });
  }
  let ringMasterGain = null;
  function startRingTone() {
    stopRingTone();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    ringMasterGain = audioCtx.createGain();
    ringMasterGain.gain.value = 1;
    ringMasterGain.connect(audioCtx.destination);
    // Schedule the full ring window (2 minutes) of beeps up-front using the audio clock
    // itself, rather than setInterval, so the ring keeps sounding reliably even if the
    // advisor has switched to another tab/app and the browser throttles JS timers.
    const spacing = 1.5;
    const totalSeconds = 130;
    const startTime = audioCtx.currentTime + 0.05;
    for (let t = 0; t < totalSeconds; t += spacing) playRingBeep(startTime + t);
  }
  function stopRingTone() {
    if (ringMasterGain) {
      try {
        ringMasterGain.disconnect();
      } catch (e) {}
      ringMasterGain = null;
    }
  }

  // Desktop/mobile OS-level notification, so the advisor is alerted even if they've
  // switched away from this browser tab/app entirely (sound alone may not surface then).
  function notifyIncomingChat(visitor) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.hasFocus()) return; // already looking at it - no need to interrupt
    try {
      const n = new Notification("Incoming chat request", {
        body: `${visitor?.full_name || "A visitor"} needs an advisor${visitor?.company_name ? " - " + visitor.company_name : ""}`,
        tag: "mc-incoming-chat",
        requireInteraction: true,
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (e) {}
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  }
  function requestNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  // ---------------- Branding (company logo replaces the "T" mark once uploaded) ----------------
  async function loadBranding() {
    try {
      const b = await fetch("/api/branding").then((r) => r.json());
      if (brandNameEl) brandNameEl.textContent = b.company_name || "McTimothy Associates";
      if (brandBadge) {
        brandBadge.innerHTML = b.company_logo
          ? `<img src="${b.company_logo}" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />`
          : "T";
      }
    } catch (e) {}
  }
  loadBranding();

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.getElementById("toastRoot").appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ---------------- AUTH ----------------
  document.getElementById("loginBtn").addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errEl = document.getElementById("loginError");
    errEl.style.display = "none";
    try {
      const data = await api("/api/advisors/login", { method: "POST", body: JSON.stringify({ email, password }) });
      token = data.token;
      localStorage.setItem("mc_advisor_token", token);
      advisor = data.advisor;
      boot();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("mc_advisor_token");
    location.reload();
  });

  async function boot() {
    try {
      const data = await api("/api/advisors/me");
      advisor = data.advisor;
    } catch (e) {
      localStorage.removeItem("mc_advisor_token");
      return;
    }
    loginView.classList.add("hidden");
    appShell.classList.remove("hidden");
    advisorNameLabel.textContent = advisor.name;
    updateStatusBtn();
    connectSocket();
    refreshQueueBadge();
    setInterval(refreshQueueBadge, 15000);
    try {
      const qr = await api("/api/quick-replies");
      quickReplies = qr.quickReplies || [];
    } catch (e) {}
    // If the advisor is picking up a chat that's already active for them (e.g. after a
    // refresh), make sure this socket is in that chat's room so their own replies show up.
    if (advisor.active_chat_id) currentChatId = advisor.active_chat_id;
    showView("dashboard");
  }

  function updateStatusBtn() {
    if (advisor.status === "busy") {
      statusBtn.textContent = "On a chat";
      statusBtn.disabled = true;
      statusBtn.className = "btn ghost";
    } else if (advisor.status === "active") {
      statusBtn.textContent = "Go offline";
      statusBtn.disabled = false;
      statusBtn.className = "btn ghost";
    } else {
      statusBtn.textContent = "Go active";
      statusBtn.disabled = false;
      statusBtn.className = "btn yellow";
    }
  }

  statusBtn.addEventListener("click", async () => {
    const next = advisor.status === "active" ? "offline" : "active";
    try {
      await api("/api/advisors/me/status", { method: "POST", body: JSON.stringify({ status: next }) });
      advisor.status = next;
      updateStatusBtn();
      toast(next === "active" ? "You're now active and can receive chats." : "You're now offline.");
      if (next === "active") {
        // Going active is a clear signal the advisor wants to be reachable - this is also
        // a user gesture, so it's the right moment to (re)request notification permission
        // and make sure the ring tone's audio context is unlocked and ready.
        requestNotificationPermission();
        if (!audioCtx) {
          try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          } catch (e) {}
        } else if (audioCtx.state === "suspended") {
          audioCtx.resume().catch(() => {});
        }
      }
    } catch (e) {
      toast(e.message);
    }
  });

  // ---------------- SOCKET ----------------
  function connectSocket() {
    socket = io();
    socket.emit("advisor_hello", { token });
    socket.on("incoming_chat_request", (payload) => {
      openRingModal(payload);
      notifyIncomingChat(payload.visitor);
    });
    socket.on("chat_claimed", ({ chatId }) => {
      if (pendingRing && pendingRing.chatId === chatId) closeRingModal();
      if (document.body.dataset.view === "queue") renderQueue();
    });
    socket.on("new_message", (m) => {
      if (currentChatId && m.chat_id === currentChatId && document.body.dataset.view === "dashboard") {
        appendDashboardMessage(m);
      }
    });
    socket.on("client_message", ({ chatId, body }) => {
      if (currentChatId === chatId && document.body.dataset.view === "dashboard") {
        appendDashboardMessage({ sender_type: "client", body });
      } else {
        toast("New client message on an active chat");
      }
    });
  }

  function openRingModal(payload) {
    pendingRing = payload;
    document.getElementById("ringVisitor").textContent = `${payload.visitor.full_name} - ${payload.visitor.company_name || "Individual"}`;
    ringModal.classList.remove("hidden");
    let remaining = Math.floor((payload.timeoutMs || 120000) / 1000);
    const el = document.getElementById("ringCountdown");
    clearInterval(ringTimer);
    const tick = () => {
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2, "0");
      el.textContent = `${m}:${s}`;
      if (remaining <= 0) closeRingModal();
      remaining--;
    };
    tick();
    ringTimer = setInterval(tick, 1000);
    if (!document.title.startsWith("(!) ")) document.title = "(!) " + document.title;
    startRingTone();
  }

  function closeRingModal() {
    ringModal.classList.add("hidden");
    clearInterval(ringTimer);
    pendingRing = null;
    document.title = document.title.replace("(!) ", "");
    stopRingTone();
  }

  document.getElementById("dismissRingBtn").addEventListener("click", closeRingModal);
  document.getElementById("acceptRingBtn").addEventListener("click", async () => {
    if (!pendingRing) return;
    try {
      await api(`/api/chats/${pendingRing.chatId}/accept`, { method: "POST" });
      currentChatId = pendingRing.chatId;
      // Join this chat's socket room - without this the advisor's own replies only ever
      // reach the client's screen and never echo back to the advisor's own dashboard.
      if (socket) socket.emit("join_chat", { chatId: currentChatId });
      closeRingModal();
      advisor.status = "busy";
      updateStatusBtn();
      showView("dashboard");
      toast("Chat accepted");
    } catch (e) {
      toast(e.message);
      closeRingModal();
    }
  });

  async function refreshQueueBadge() {
    try {
      const data = await api("/api/advisors/me/queue");
      queueBadge.textContent = `${data.queue.length} waiting`;
    } catch (e) {}
  }

  // ---------------- NAV ----------------
  document.querySelectorAll(".nav button").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  function showView(view) {
    document.body.dataset.view = view;
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    const titles = {
      dashboard: "Active chat",
      queue: "Queue",
      visitors: "Visitor log",
      questions: "Unanswered questions",
      calendar: "Calendar",
      logs: "My logs",
      proposals: "Corporate proposal requests",
      appraisals: "My performance",
      profile: "My profile",
    };
    viewTitle.textContent = titles[view] || "";
    if (view === "dashboard") renderDashboard();
    if (view === "queue") renderQueue();
    if (view === "visitors") renderVisitors();
    if (view === "questions") renderUnansweredQuestions();
    if (view === "calendar") renderCalendar();
    if (view === "logs") renderLogs();
    if (view === "proposals") renderProposals();
    if (view === "appraisals") renderAppraisals();
    if (view === "profile") renderProfile();
  }

  // ---------------- VISITOR LOG ----------------
  async function renderVisitors() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/visitors");
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Course interest</th><th>Seen</th></tr></thead>
        <tbody>${d.visitors
          .map(
            (v) => `<tr>
              <td>${escapeHtml(v.full_name)}</td><td>${escapeHtml(v.company_name || "-")}</td>
              <td>${escapeHtml(v.email)}</td><td>${escapeHtml(v.course || "-")}</td>
              <td>${escapeHtml(v.created_at)}</td>
            </tr>`
          )
          .join("") || `<tr><td colspan="5" class="empty">No visitors yet</td></tr>`}
        </tbody>
      </table></div>`;
  }

  // ---------------- UNANSWERED QUESTIONS ----------------
  async function renderUnansweredQuestions() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/unanswered-questions");
    if (!d.questions.length) {
      content.innerHTML = `<div class="card empty">No unanswered questions right now - nice!</div>`;
      return;
    }
    content.innerHTML = d.questions
      .map(
        (q) => `<div class="card" style="margin-bottom:12px;">
          <div style="font-size:12px;color:var(--ink-soft);">${escapeHtml(q.full_name || "Visitor")} ${q.company_name ? "- " + escapeHtml(q.company_name) : ""} - ${escapeHtml(q.created_at)}</div>
          <div style="font-weight:700;margin:6px 0 10px;">${escapeHtml(q.question)}</div>
          <textarea data-answer="${q.id}" placeholder="Type the answer to add as an FAQ..." style="width:100%;min-height:70px;margin-bottom:8px;"></textarea>
          <div style="display:flex;gap:8px;">
            <button class="btn ghost small" data-dismiss="${q.id}" style="flex:1;">Dismiss</button>
            <button class="btn yellow small" data-save="${q.id}" style="flex:1;">Save as FAQ &amp; Quick Answer</button>
          </div>
        </div>`
      )
      .join("");
    content.querySelectorAll("[data-save]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.save;
        const answer = content.querySelector(`[data-answer="${id}"]`).value.trim();
        if (!answer) return toast("Type an answer first");
        await api(`/api/admin/unanswered-questions/${id}/answer`, { method: "POST", body: JSON.stringify({ answer }) });
        toast("Added to FAQs & Quick Answers");
        renderUnansweredQuestions();
      })
    );
    content.querySelectorAll("[data-dismiss]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await api(`/api/admin/unanswered-questions/${btn.dataset.dismiss}`, { method: "DELETE" });
        renderUnansweredQuestions();
      })
    );
  }

  // ---------------- CALENDAR ----------------
  async function renderCalendar() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/calendars");
    content.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h4 style="margin-bottom:10px;">Add a calendar</h4>
        <div class="field"><label>Name</label><input id="calName" placeholder="e.g. Ada's booking calendar" /></div>
        <div class="field"><label>Booking link (Google Calendar, Calendly, etc.)</label><input id="calLink" placeholder="https://..." /></div>
        <div class="field"><label>Or upload a calendar file (.ics)</label><input type="file" id="calFile" accept=".ics,text/calendar" /></div>
        <button class="btn yellow" id="calAddBtn">Add calendar</button>
      </div>
      <div class="grid cols-3">
        ${d.calendars
          .map(
            (c) => `<div class="card">
              <strong>${escapeHtml(c.name)}</strong>
              ${c.is_active ? `<div class="pill green" style="margin-top:6px;">Active - shared with clients</div>` : ""}
              <div style="margin:8px 0;font-size:13px;word-break:break-all;">
                ${c.link ? `<a href="${c.link}" target="_blank">${escapeHtml(c.link)}</a>` : ""}
                ${c.file_url ? `<a href="${c.file_url}" target="_blank">View uploaded calendar file</a>` : ""}
              </div>
              <div style="display:flex;gap:8px;">
                ${c.is_active ? "" : `<button class="btn small ghost" data-select-cal="${c.id}" style="flex:1;">Set as active</button>`}
                <button class="btn small danger" data-delete-cal="${c.id}" style="flex:1;">Delete</button>
              </div>
            </div>`
          )
          .join("") || `<div class="card empty">No calendars added yet.</div>`}
      </div>`;

    document.getElementById("calAddBtn").addEventListener("click", async () => {
      const name = document.getElementById("calName").value.trim();
      const link = document.getElementById("calLink").value.trim();
      const file = document.getElementById("calFile").files[0];
      if (!name || (!link && !file)) return toast("Give it a name and either a link or a file");
      let file_url = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/uploads/document", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        const out = await res.json();
        if (!out.url) return toast("Upload failed");
        file_url = out.url;
      }
      await api("/api/admin/calendars", { method: "POST", body: JSON.stringify({ name, link: link || null, file_url }) });
      toast("Calendar added");
      renderCalendar();
    });
    content.querySelectorAll("[data-select-cal]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api(`/api/admin/calendars/${b.dataset.selectCal}/select`, { method: "PUT" });
        renderCalendar();
      })
    );
    content.querySelectorAll("[data-delete-cal]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this calendar?")) return;
        await api(`/api/admin/calendars/${b.dataset.deleteCal}`, { method: "DELETE" });
        renderCalendar();
      })
    );
  }

  // ---------------- DASHBOARD (active chat) ----------------
  async function renderDashboard() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const data = await api("/api/advisors/me/chats");
    if (!data.active) {
      currentChatId = null;
      content.innerHTML = `<div class="card empty">No active chat right now. Go active and accept a request, or pick one up from the Queue tab.</div>`;
      return;
    }
    currentChatId = data.active.id;
    if (socket) socket.emit("join_chat", { chatId: currentChatId });
    const chatData = await api(`/api/chats/${data.active.id}`);
    content.innerHTML = `
      <div class="grid cols-2" style="grid-template-columns: 2fr 1fr; align-items:start;">
        <div class="card" style="padding:0;overflow:hidden;">
          <div style="padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong>${escapeHtml(chatData.visitor.full_name)}</strong>
              <div style="font-size:12.5px;color:var(--ink-soft);">${escapeHtml(chatData.visitor.company_name || "Individual")} - ${escapeHtml(chatData.visitor.email)}</div>
            </div>
            <button class="btn danger small" id="closeChatBtn">Close chat</button>
          </div>
          <div id="dashMessages" style="height:340px;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:var(--paper);"></div>
          <div style="padding:8px 10px 0;display:flex;gap:6px;flex-wrap:wrap;" id="quickReplyBar">
            ${quickReplies
              .slice(0, 3)
              .map((qr) => `<button class="btn small ghost" data-quick="${qr.id}" title="${escapeHtml(qr.body)}">${escapeHtml(qr.label)}</button>`)
              .join("")}
          </div>
          <div style="border-top:1px solid var(--line);padding:10px;display:flex;gap:8px;">
            <input id="dashInput" placeholder="Type a reply..." />
            <button class="btn" id="dashSendBtn">Send</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="card">
            <h4 style="margin-bottom:10px;">Send a link</h4>
            <div class="field"><label>Type</label>
              <select id="resKind"><option value="receipt">Receipt link</option><option value="calendar">Calendar link</option><option value="proposal">Proposal link</option></select>
            </div>
            <div class="field"><label>Link URL</label><input id="resLink" placeholder="https://..." /></div>
            <button class="btn secondary" id="sendResBtn" style="width:100%;">Send to client</button>
            <div style="border-top:1px solid var(--line);margin:14px 0 10px;"></div>
            <label>Or upload an existing proposal (PDF/Word)</label>
            <input type="file" id="proposalFileInput" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            <div style="font-size:12px;color:var(--ink-soft);margin-top:4px;" id="proposalUploadStatus"></div>
          </div>
          <div class="card">
            <h4 style="margin-bottom:6px;">Visitor record</h4>
            <div style="font-size:13px;color:var(--ink-soft);">Course interest: ${escapeHtml(chatData.visitor.course || "-")}</div>
            <div style="font-size:13px;color:var(--ink-soft);">Started: ${escapeHtml(chatData.chat.started_at || "-")}</div>
          </div>
        </div>
      </div>`;

    const msgBox = document.getElementById("dashMessages");
    chatData.messages.forEach((m) => msgBox.appendChild(renderMsgEl(m)));
    msgBox.scrollTop = msgBox.scrollHeight;

    document.getElementById("dashSendBtn").addEventListener("click", sendDashMessage);
    document.getElementById("dashInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendDashMessage();
    });
    document.querySelectorAll("#quickReplyBar [data-quick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const qr = quickReplies.find((q) => q.id == btn.dataset.quick);
        if (!qr) return;
        const input = document.getElementById("dashInput");
        input.value = qr.body.replace("{advisor_name}", advisor.name || "");
        input.focus();
      });
    });
    document.getElementById("proposalFileInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById("proposalUploadStatus");
      statusEl.textContent = "Uploading...";
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/uploads/document", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || "Upload failed");
        await api(`/api/chats/${currentChatId}/resources`, {
          method: "POST",
          body: JSON.stringify({ kind: "proposal", link: out.url }),
        });
        statusEl.textContent = `Sent: ${file.name}`;
        toast("Proposal sent to client");
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });
    document.getElementById("sendResBtn").addEventListener("click", async () => {
      const kind = document.getElementById("resKind").value;
      const link = document.getElementById("resLink").value.trim();
      if (!link) return toast("Enter a link first");
      await api(`/api/chats/${currentChatId}/resources`, { method: "POST", body: JSON.stringify({ kind, link }) });
      document.getElementById("resLink").value = "";
      toast("Link sent to client");
    });
    document.getElementById("closeChatBtn").addEventListener("click", openCloseChatModal);
  }

  function renderMsgEl(m) {
    const div = document.createElement("div");
    if (m.sender_type === "system") {
      div.className = "msg system";
      div.textContent = m.body;
    } else {
      div.className = `msg ${m.sender_type === "advisor" ? "advisor" : m.sender_type === "client" ? "client" : "bot"}`;
      const label = m.sender_type === "client" ? "Client" : m.sender_name || (m.sender_type === "bot" ? "Tim" : "You");
      div.innerHTML = `<span class="sender">${escapeHtml(label)}</span>${escapeHtml(m.body)}`;
    }
    return div;
  }

  function appendDashboardMessage(m) {
    const box = document.getElementById("dashMessages");
    if (!box) return;
    box.appendChild(renderMsgEl(m));
    box.scrollTop = box.scrollHeight;
  }

  async function sendDashMessage() {
    const input = document.getElementById("dashInput");
    const body = input.value.trim();
    if (!body || !currentChatId) return;
    input.value = "";
    await api(`/api/chats/${currentChatId}/messages`, { method: "POST", body: JSON.stringify({ body }) });
  }

  function openCloseChatModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal">
        <h3>Close this chat</h3>
        <div class="field"><label>Issue summary</label><input id="closeIssue" placeholder="e.g. Pricing inquiry" /></div>
        <div class="field"><label>Resolution notes</label><textarea id="closeResolution" placeholder="How was it resolved?"></textarea></div>
        <div class="field" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="closeFlag" style="width:auto;" />
          <label style="margin:0;">Raise a flag for the company to review</label>
        </div>
        <div class="field hidden" id="flagReasonWrap"><label>Flag reason</label><textarea id="closeFlagReason"></textarea></div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <button class="btn ghost" id="cancelCloseBtn" style="flex:1;">Cancel</button>
          <button class="btn danger" id="confirmCloseBtn" style="flex:1;">End chat</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    document.getElementById("closeFlag").addEventListener("change", (e) => {
      document.getElementById("flagReasonWrap").classList.toggle("hidden", !e.target.checked);
    });
    document.getElementById("cancelCloseBtn").addEventListener("click", () => backdrop.remove());
    document.getElementById("confirmCloseBtn").addEventListener("click", async () => {
      const issue = document.getElementById("closeIssue").value.trim();
      const resolution = document.getElementById("closeResolution").value.trim();
      const flagged = document.getElementById("closeFlag").checked;
      const flag_reason = document.getElementById("closeFlagReason").value.trim();
      await api(`/api/chats/${currentChatId}/close`, {
        method: "POST",
        body: JSON.stringify({ issue, resolution, flagged, flag_reason }),
      });
      backdrop.remove();
      advisor.status = "active";
      updateStatusBtn();
      currentChatId = null;
      toast("Chat closed and logged");
      renderDashboard();
    });
  }

  // ---------------- QUEUE ----------------
  async function renderQueue() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const data = await api("/api/advisors/me/queue");
    refreshQueueBadge();
    if (!data.queue.length) {
      content.innerHTML = `<div class="card empty">No one is waiting right now.</div>`;
      return;
    }
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Client</th><th>Company</th><th>Status</th><th>Waiting since</th><th></th></tr></thead>
        <tbody>${data.queue
          .map(
            (c) => `<tr>
              <td>${escapeHtml(c.full_name)}</td>
              <td>${escapeHtml(c.company_name || "-")}</td>
              <td><span class="pill ${c.status === "ringing" ? "yellow" : "grey"}">${c.status}</span></td>
              <td>${escapeHtml(c.queue_requested_at || "-")}</td>
              <td><button class="btn small" data-accept="${c.chat_id}">Accept</button></td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>`;
    content.querySelectorAll("[data-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/chats/${btn.dataset.accept}/accept`, { method: "POST" });
          currentChatId = Number(btn.dataset.accept);
          if (socket) socket.emit("join_chat", { chatId: currentChatId });
          advisor.status = "busy";
          updateStatusBtn();
          showView("dashboard");
        } catch (e) {
          toast(e.message);
          renderQueue();
        }
      });
    });
  }

  // ---------------- LOGS ----------------
  async function renderLogs() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const data = await api("/api/advisors/me/logs");
    if (!data.logs.length) {
      content.innerHTML = `<div class="card empty">No complaint logs yet.</div>`;
      return;
    }
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Client</th><th>Issue</th><th>Resolution</th><th>Flag</th><th>Date</th></tr></thead>
        <tbody>${data.logs
          .map(
            (l) => `<tr>
              <td>${escapeHtml(l.full_name)}<br><span style="color:var(--ink-soft);font-size:12px;">${escapeHtml(l.company_name || "")}</span></td>
              <td>${escapeHtml(l.issue)}</td>
              <td>${escapeHtml(l.resolution || "-")}</td>
              <td>${l.flagged ? `<span class="pill red">${escapeHtml(l.flag_status)}</span>` : `<span class="pill grey">none</span>`}</td>
              <td>${escapeHtml(l.created_at)}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>`;
  }

  // ---------------- PROPOSALS ----------------
  async function renderProposals() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const data = await api("/api/admin/proposals");
    if (!data.proposals.length) {
      content.innerHTML = `<div class="card empty">No proposal requests yet.</div>`;
      return;
    }
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Company</th><th>Topic</th><th>Staff</th><th>Preferred date</th><th>Status</th><th>Document</th><th></th></tr></thead>
        <tbody>${data.proposals
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.company_name)}</td><td>${escapeHtml(p.training_topic)}</td>
              <td>${escapeHtml(p.staff_count)}</td><td>${escapeHtml(p.preferred_date)}</td>
              <td><button class="btn small ${p.status === "sent" ? "" : "ghost"}" data-toggle-status="${p.id}" data-current="${p.status}">${p.status === "sent" ? "Sent" : "Pending"}</button></td>
              <td>${p.document_url ? `<a href="${p.document_url}" target="_blank">View</a>` : "-"}</td>
              <td style="white-space:nowrap;"><button class="btn small ghost" data-generate="${p.id}">Generate</button></td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>`;
    content.querySelectorAll("[data-toggle-status]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const next = btn.dataset.current === "sent" ? "pending" : "sent";
        await api(`/api/admin/proposals/${btn.dataset.toggleStatus}`, { method: "PUT", body: JSON.stringify({ status: next }) });
        toast(`Marked as ${next}`);
        renderProposals();
      })
    );
    content.querySelectorAll("[data-generate]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const p = data.proposals.find((x) => x.id == btn.dataset.generate);
        openProposalGenerator(p);
      })
    );
  }

  // Renders the admin's chosen background template with this proposal's details on top,
  // so the background always automatically matches whichever template the admin selected.
  async function openProposalGenerator(proposal) {
    let templates = [];
    try {
      templates = (await api("/api/proposal-templates")).templates || [];
    } catch (e) {}
    const active = templates.find((t) => t.is_active) || templates[0];
    if (!active) {
      toast("No proposal background template has been uploaded by the admin yet.");
      return;
    }
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal" style="width:640px;">
      <h3>Generate proposal</h3>
      <canvas id="proposalCanvas" style="width:100%;border:1px solid var(--line);border-radius:8px;margin:10px 0;"></canvas>
      <div style="display:flex;gap:8px;">
        <button class="btn ghost" id="pgCancel" style="flex:1;">Close</button>
        <button class="btn secondary" id="pgDownload" style="flex:1;">Download</button>
        <button class="btn yellow" id="pgSend" style="flex:1;">Save &amp; attach to request</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#pgCancel").addEventListener("click", () => backdrop.remove());

    const canvas = backdrop.querySelector("#proposalCanvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(canvas.width * 0.08, canvas.height * 0.66, canvas.width * 0.84, canvas.height * 0.28);
      ctx.fillStyle = "#101B49";
      ctx.textBaseline = "top";
      let y = canvas.height * 0.68;
      const pad = canvas.width * 0.1;
      const lh = canvas.height * 0.045;
      ctx.font = `bold ${Math.round(canvas.width * 0.032)}px Georgia, serif`;
      ctx.fillText(`Training Proposal for ${proposal.company_name || "Client"}`, pad, y);
      y += lh * 1.4;
      ctx.font = `${Math.round(canvas.width * 0.02)}px Arial`;
      [
        `Topic: ${proposal.training_topic || "-"}`,
        `Number of staff: ${proposal.staff_count || "-"}`,
        `Preferred date: ${proposal.preferred_date || "-"}`,
        `Prepared by: ${advisor.name}`,
      ].forEach((line) => {
        ctx.fillText(line, pad, y);
        y += lh;
      });
    };
    img.src = active.image_url;

    backdrop.querySelector("#pgDownload").addEventListener("click", () => {
      const a = document.createElement("a");
      a.download = `proposal-${proposal.company_name || proposal.id}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    });
    backdrop.querySelector("#pgSend").addEventListener("click", () => {
      canvas.toBlob(async (blob) => {
        const fd = new FormData();
        fd.append("image", blob, `proposal-${proposal.id}.png`);
        const res = await fetch("/api/uploads/image", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        const out = await res.json();
        if (!out.url) return toast("Upload failed");
        await api(`/api/admin/proposals/${proposal.id}`, { method: "PUT", body: JSON.stringify({ document_url: out.url, status: "sent" }) });
        toast("Proposal generated and attached");
        backdrop.remove();
        renderProposals();
      }, "image/png");
    });
  }

  // ---------------- APPRAISALS ----------------
  async function renderAppraisals() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const data = await api("/api/advisors/me/appraisals");
    if (!data.appraisals.length) {
      content.innerHTML = `<div class="card empty">Nothing here yet - your admin hasn't logged an appraisal or warning.</div>`;
      return;
    }
    content.innerHTML = `<div class="grid" style="gap:10px;">${data.appraisals
      .map(
        (a) => `<div class="card">
          <span class="pill ${a.type === "warning" ? "red" : "green"}">${a.type}</span>
          <p style="margin:10px 0 4px;">${escapeHtml(a.message)}</p>
          <span style="font-size:12px;color:var(--ink-soft);">${escapeHtml(a.created_at)}</span>
        </div>`
      )
      .join("")}</div>`;
  }

  // ---------------- PROFILE ----------------
  async function renderProfile() {
    const data = await api("/api/advisors/me");
    const a = data.advisor;
    content.innerHTML = `<div class="card" style="max-width:480px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <img id="profilePicPreview" src="${a.profile_pic || placeholderAvatar(a.name)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;background:#eee;" />
        <div>
          <input type="file" id="profilePicInput" accept="image/*" />
        </div>
      </div>
      <div class="field"><label>Full name</label><input id="pName" value="${escapeAttr(a.name)}" /></div>
      <div class="field"><label>Staff ID</label><input id="pStaffId" value="${escapeAttr(a.staff_id || "")}" /></div>
      <div class="field"><label>Phone</label><input id="pPhone" value="${escapeAttr(a.phone || "")}" /></div>
      <div class="field"><label>Address</label><input id="pAddress" value="${escapeAttr(a.address || "")}" /></div>
      <div class="field"><label>Email (read-only, contact admin to change)</label><input value="${escapeAttr(a.email)}" disabled /></div>
      <button class="btn" id="saveProfileBtn">Save changes</button>
    </div>

    <div class="card" style="max-width:480px;margin-top:16px;">
      <h4 style="margin-bottom:10px;">Company logo</h4>
      <p style="color:var(--ink-soft);font-size:13px;margin-top:0;">This replaces the "T / McTimothy Associates" mark at the top-left of the widget and both portals for everyone - not just you.</p>
      <div style="display:flex;align-items:center;gap:14px;">
        <img id="companyLogoPreview" src="" style="width:56px;height:56px;border-radius:8px;object-fit:cover;background:#eee;display:none;" />
        <input type="file" id="companyLogoInput" accept="image/*" />
      </div>
    </div>`;

    let newPic = null;
    document.getElementById("profilePicInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/uploads/image", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const out = await res.json();
      if (out.url) {
        newPic = out.url;
        document.getElementById("profilePicPreview").src = out.url;
      }
    });

    document.getElementById("saveProfileBtn").addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("pName").value.trim(),
        staff_id: document.getElementById("pStaffId").value.trim(),
        phone: document.getElementById("pPhone").value.trim(),
        address: document.getElementById("pAddress").value.trim(),
      };
      if (newPic) payload.profile_pic = newPic;
      const out = await api("/api/advisors/me", { method: "PUT", body: JSON.stringify(payload) });
      advisor = out.advisor;
      advisorNameLabel.textContent = advisor.name;
      toast("Profile updated");
    });

    loadBranding().then(() => {
      const badgeImg = brandBadge?.querySelector("img");
      if (badgeImg) {
        document.getElementById("companyLogoPreview").src = badgeImg.src;
        document.getElementById("companyLogoPreview").style.display = "block";
      }
    });
    document.getElementById("companyLogoInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/uploads/image", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const out = await res.json();
      if (!out.url) return;
      await api("/api/branding", { method: "PUT", body: JSON.stringify({ company_logo: out.url }) });
      document.getElementById("companyLogoPreview").src = out.url;
      document.getElementById("companyLogoPreview").style.display = "block";
      loadBranding();
      toast("Company logo updated");
    });
  }

  function placeholderAvatar(name) {
    const initial = (name || "?").trim()[0] || "?";
    return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='%231B2A6B'/><text x='50%25' y='58%25' font-size='26' fill='white' text-anchor='middle' font-family='Georgia'>${initial}</text></svg>`;
  }

  function escapeHtml(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  if (token) boot();
})();
