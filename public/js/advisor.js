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
  }

  function closeRingModal() {
    ringModal.classList.add("hidden");
    clearInterval(ringTimer);
    pendingRing = null;
    document.title = document.title.replace("(!) ", "");
  }

  document.getElementById("dismissRingBtn").addEventListener("click", closeRingModal);
  document.getElementById("acceptRingBtn").addEventListener("click", async () => {
    if (!pendingRing) return;
    try {
      await api(`/api/chats/${pendingRing.chatId}/accept`, { method: "POST" });
      currentChatId = pendingRing.chatId;
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
      logs: "My logs",
      proposals: "Corporate proposal requests",
      appraisals: "My performance",
      profile: "My profile",
    };
    viewTitle.textContent = titles[view] || "";
    if (view === "dashboard") renderDashboard();
    if (view === "queue") renderQueue();
    if (view === "logs") renderLogs();
    if (view === "proposals") renderProposals();
    if (view === "appraisals") renderAppraisals();
    if (view === "profile") renderProfile();
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
          <div id="dashMessages" style="height:380px;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:var(--paper);"></div>
          <div style="border-top:1px solid var(--line);padding:10px;display:flex;gap:8px;">
            <input id="dashInput" placeholder="Type a reply..." />
            <button class="btn" id="dashSendBtn">Send</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="card">
            <h4 style="margin-bottom:10px;">Send a link</h4>
            <div class="field"><label>Type</label>
              <select id="resKind"><option value="receipt">Receipt link</option><option value="calendar">Calendar link</option></select>
            </div>
            <div class="field"><label>Link URL</label><input id="resLink" placeholder="https://..." /></div>
            <button class="btn secondary" id="sendResBtn" style="width:100%;">Send to client</button>
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
        <thead><tr><th>Company</th><th>Topic</th><th>Staff</th><th>Preferred date</th><th>Status</th></tr></thead>
        <tbody>${data.proposals
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.company_name)}</td><td>${escapeHtml(p.training_topic)}</td>
              <td>${escapeHtml(p.staff_count)}</td><td>${escapeHtml(p.preferred_date)}</td>
              <td><span class="pill grey">${escapeHtml(p.status)}</span></td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>`;
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
