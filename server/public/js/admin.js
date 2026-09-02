(function () {
  let token = localStorage.getItem("mc_admin_token") || null;
  let admin = null;

  const loginView = document.getElementById("loginView");
  const appShell = document.getElementById("appShell");
  const content = document.getElementById("content");
  const viewTitle = document.getElementById("viewTitle");
  const adminNameLabel = document.getElementById("adminNameLabel");
  const companyNameLabel = document.getElementById("companyNameLabel");

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.getElementById("toastRoot").appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function escapeHtml(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
      const data = await api("/api/admins/login", { method: "POST", body: JSON.stringify({ email, password }) });
      token = data.token;
      localStorage.setItem("mc_admin_token", token);
      admin = data.admin;
      boot();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = "block";
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("mc_admin_token");
    location.reload();
  });

  async function boot() {
    try {
      const data = await api("/api/admins/me");
      admin = data.admin;
    } catch (e) {
      localStorage.removeItem("mc_admin_token");
      return;
    }
    loginView.classList.add("hidden");
    appShell.classList.remove("hidden");
    adminNameLabel.textContent = admin.name || admin.email;
    companyNameLabel.textContent = admin.company_name || "McTimothy Associates";
    showView("analytics");
  }

  document.querySelectorAll(".nav button").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));

  function showView(view) {
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    const titles = {
      analytics: "Analytics",
      advisors: "Advisors",
      visitors: "Visitor records",
      logs: "Complaint logs & flags",
      faqs: "Frequently asked questions",
      brochures: "Brochures & pricing",
      quick: "Quick answers",
      proposals: "Corporate proposal requests",
      profile: "Company profile",
    };
    viewTitle.textContent = titles[view] || "";
    const renderers = { analytics: renderAnalytics, advisors: renderAdvisors, visitors: renderVisitors, logs: renderLogs, faqs: renderFaqs, brochures: renderBrochures, quick: renderQuick, proposals: renderProposals, profile: renderProfile };
    (renderers[view] || (() => {}))();
  }

  // ---------------- ANALYTICS ----------------
  async function renderAnalytics() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/analytics");
    content.innerHTML = `
      <div class="grid cols-4">
        <div class="card stat"><div class="num">${d.totalChats}</div><div class="label">Total chats</div></div>
        <div class="card stat"><div class="num">${d.closedChats}</div><div class="label">Chats closed by advisors</div></div>
        <div class="card stat"><div class="num">${d.totalVisitors}</div><div class="label">Visitors recorded</div></div>
        <div class="card stat"><div class="num">${d.flaggedOpen}</div><div class="label">Open flags</div></div>
      </div>
      <div class="grid cols-2" style="margin-top:16px;">
        <div class="card">
          <h4>Cases per advisor</h4>
          <table><thead><tr><th>Advisor</th><th>Chats handled</th><th>Closed</th></tr></thead>
          <tbody>${d.perAdvisor
            .map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${a.chats_handled || 0}</td><td>${a.chats_closed || 0}</td></tr>`)
            .join("") || `<tr><td colspan="3" class="empty">No advisors yet</td></tr>`}
          </tbody></table>
        </div>
        <div class="card">
          <h4>Chats by day (last 14 days)</h4>
          <table><thead><tr><th>Day</th><th>Chats</th></tr></thead>
          <tbody>${d.chatsByDay.map((r) => `<tr><td>${escapeHtml(r.day)}</td><td>${r.c}</td></tr>`).join("") || `<tr><td colspan="2" class="empty">No data yet</td></tr>`}
          </tbody></table>
        </div>
      </div>
      <div class="card" style="margin-top:16px;">
        <div class="grid cols-2">
          <div><strong>${d.proposalsCount}</strong> corporate proposal requests received</div>
          <div><strong>${d.botOnlyChats}</strong> chats fully handled by Tim without an advisor</div>
        </div>
      </div>`;
  }

  // ---------------- ADVISORS ----------------
  async function renderAdvisors() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/advisors");
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button class="btn yellow" id="addAdvisorBtn">Add advisor</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Staff ID</th><th>Status</th><th></th></tr></thead>
          <tbody>${d.advisors
            .map(
              (a) => `<tr>
                <td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.email)}</td><td>${escapeHtml(a.staff_id || "-")}</td>
                <td><span class="pill ${a.status === "active" ? "green" : a.status === "busy" ? "yellow" : "grey"}">${a.status}</span></td>
                <td style="white-space:nowrap;">
                  <button class="btn small ghost" data-edit="${a.id}">Edit</button>
                  <button class="btn small ghost" data-appraise="${a.id}">Appraise</button>
                  <button class="btn small danger" data-delete="${a.id}">Delete</button>
                </td>
              </tr>`
            )
            .join("") || `<tr><td colspan="5" class="empty">No advisors yet - add your first one.</td></tr>`}
          </tbody>
        </table>
      </div>`;

    document.getElementById("addAdvisorBtn").addEventListener("click", () => openAdvisorModal(null));
    content.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => openAdvisorModal(d.advisors.find((a) => a.id == b.dataset.edit)))
    );
    content.querySelectorAll("[data-appraise]").forEach((b) =>
      b.addEventListener("click", () => openAppraiseModal(b.dataset.appraise))
    );
    content.querySelectorAll("[data-delete]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Remove this advisor?")) return;
        await api(`/api/admin/advisors/${b.dataset.delete}`, { method: "DELETE" });
        renderAdvisors();
      })
    );
  }

  function openAdvisorModal(existing) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal">
      <h3>${existing ? "Edit advisor" : "Add advisor"}</h3>
      <div class="field"><label>Full name</label><input id="mName" value="${escapeHtml(existing?.name || "")}" /></div>
      <div class="field"><label>Email</label><input id="mEmail" value="${escapeHtml(existing?.email || "")}" /></div>
      <div class="field"><label>${existing ? "New password (leave blank to keep current)" : "Password"}</label><input id="mPassword" type="password" /></div>
      <div class="field"><label>Staff ID</label><input id="mStaffId" value="${escapeHtml(existing?.staff_id || "")}" /></div>
      <div class="field"><label>Phone</label><input id="mPhone" value="${escapeHtml(existing?.phone || "")}" /></div>
      <div class="field"><label>Address</label><input id="mAddress" value="${escapeHtml(existing?.address || "")}" /></div>
      <div style="display:flex;gap:8px;">
        <button class="btn ghost" id="mCancel" style="flex:1;">Cancel</button>
        <button class="btn yellow" id="mSave" style="flex:1;">Save</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#mCancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#mSave").addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("mName").value.trim(),
        email: document.getElementById("mEmail").value.trim(),
        staff_id: document.getElementById("mStaffId").value.trim(),
        phone: document.getElementById("mPhone").value.trim(),
        address: document.getElementById("mAddress").value.trim(),
      };
      const pw = document.getElementById("mPassword").value;
      try {
        if (existing) {
          if (pw) payload.password = pw;
          await api(`/api/admin/advisors/${existing.id}`, { method: "PUT", body: JSON.stringify(payload) });
        } else {
          payload.password = pw;
          if (!pw) return toast("Password is required for a new advisor");
          await api("/api/admin/advisors", { method: "POST", body: JSON.stringify(payload) });
        }
        backdrop.remove();
        toast("Saved");
        renderAdvisors();
      } catch (e) {
        toast(e.message);
      }
    });
  }

  function openAppraiseModal(advisorId) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal">
      <h3>Log performance note</h3>
      <div class="field"><label>Type</label>
        <select id="aType"><option value="appraisal">Appraisal (positive)</option><option value="warning">Warning</option></select>
      </div>
      <div class="field"><label>Message</label><textarea id="aMessage" placeholder="Describe the performance note..."></textarea></div>
      <div style="display:flex;gap:8px;">
        <button class="btn ghost" id="aCancel" style="flex:1;">Cancel</button>
        <button class="btn yellow" id="aSave" style="flex:1;">Save</button>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#aCancel").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#aSave").addEventListener("click", async () => {
      const type = document.getElementById("aType").value;
      const message = document.getElementById("aMessage").value.trim();
      if (!message) return toast("Message is required");
      await api(`/api/admin/advisors/${advisorId}/appraisals`, { method: "POST", body: JSON.stringify({ type, message }) });
      backdrop.remove();
      toast("Logged");
    });
  }

  // ---------------- VISITORS ----------------
  async function renderVisitors() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/visitors");
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Course</th><th>Date</th></tr></thead>
        <tbody>${d.visitors
          .map(
            (v) => `<tr><td>${escapeHtml(v.full_name)}</td><td>${escapeHtml(v.company_name || "-")}</td>
              <td>${escapeHtml(v.email)}</td><td>${escapeHtml(v.course || "-")}</td><td>${escapeHtml(v.created_at)}</td></tr>`
          )
          .join("") || `<tr><td colspan="5" class="empty">No visitors yet</td></tr>`}
        </tbody>
      </table></div>`;
  }

  // ---------------- LOGS / FLAGS ----------------
  async function renderLogs() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/logs");
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Client</th><th>Advisor</th><th>Issue</th><th>Flag</th><th>Date</th><th></th></tr></thead>
        <tbody>${d.logs
          .map(
            (l) => `<tr>
              <td>${escapeHtml(l.full_name || "-")}</td>
              <td>${escapeHtml(l.advisor_name || "-")}</td>
              <td>${escapeHtml(l.issue)}</td>
              <td>${l.flagged ? `<span class="pill red">${escapeHtml(l.flag_status)}</span>` : `<span class="pill grey">none</span>`}</td>
              <td>${escapeHtml(l.created_at)}</td>
              <td>${l.flagged && l.flag_status === "open" ? `<button class="btn small ghost" data-resolve="${l.id}">Mark resolved</button>` : ""}</td>
            </tr>`
          )
          .join("") || `<tr><td colspan="6" class="empty">No complaint logs yet</td></tr>`}
        </tbody>
      </table></div>`;
    content.querySelectorAll("[data-resolve]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api(`/api/admin/logs/${b.dataset.resolve}/resolve`, { method: "PUT" });
        renderLogs();
      })
    );
  }

  // ---------------- FAQ CRUD helper (also reused for quick answers) ----------------
  function crudView({ title, listPath, createPath, updatePathFn, deletePathFn, fields, itemLabel }) {
    return async function render() {
      content.innerHTML = `<div class="empty">Loading...</div>`;
      const d = await api(listPath);
      const items = d[Object.keys(d)[0]];
      content.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
          <button class="btn yellow" id="addBtn">Add ${title}</button>
        </div>
        <div class="grid" style="gap:10px;">${items
          .map(
            (item) => `<div class="card">
              ${fields.map((f) => `<div style="margin-bottom:6px;"><strong>${f.label}:</strong> ${escapeHtml(item[f.key])}</div>`).join("")}
              <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="btn small ghost" data-edit="${item.id}">Edit</button>
                <button class="btn small danger" data-delete="${item.id}">Delete</button>
              </div>
            </div>`
          )
          .join("") || `<div class="card empty">No ${title.toLowerCase()}s yet.</div>`}
        </div>`;

      function openModal(existing) {
        const backdrop = document.createElement("div");
        backdrop.className = "modal-backdrop";
        backdrop.innerHTML = `<div class="modal">
          <h3>${existing ? "Edit" : "Add"} ${title}</h3>
          ${fields
            .map(
              (f) =>
                `<div class="field"><label>${f.label}</label>${
                  f.long
                    ? `<textarea id="f_${f.key}">${escapeHtml(existing?.[f.key] || "")}</textarea>`
                    : `<input id="f_${f.key}" value="${escapeHtml(existing?.[f.key] || "")}" />`
                }</div>`
            )
            .join("")}
          <div style="display:flex;gap:8px;">
            <button class="btn ghost" id="cCancel" style="flex:1;">Cancel</button>
            <button class="btn yellow" id="cSave" style="flex:1;">Save</button>
          </div>
        </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector("#cCancel").addEventListener("click", () => backdrop.remove());
        backdrop.querySelector("#cSave").addEventListener("click", async () => {
          const payload = {};
          fields.forEach((f) => (payload[f.key] = document.getElementById(`f_${f.key}`).value.trim()));
          try {
            if (existing) {
              await api(updatePathFn(existing.id), { method: "PUT", body: JSON.stringify(payload) });
            } else {
              await api(createPath, { method: "POST", body: JSON.stringify(payload) });
            }
            backdrop.remove();
            toast("Saved");
            render();
          } catch (e) {
            toast(e.message);
          }
        });
      }

      document.getElementById("addBtn").addEventListener("click", () => openModal(null));
      content.querySelectorAll("[data-edit]").forEach((b) =>
        b.addEventListener("click", () => openModal(items.find((i) => i.id == b.dataset.edit)))
      );
      content.querySelectorAll("[data-delete]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!confirm(`Delete this ${title.toLowerCase()}?`)) return;
          await api(deletePathFn(b.dataset.delete), { method: "DELETE" });
          render();
        })
      );
    };
  }

  const renderFaqs = crudView({
    title: "FAQ",
    listPath: "/api/faqs",
    createPath: "/api/admin/faqs",
    updatePathFn: (id) => `/api/admin/faqs/${id}`,
    deletePathFn: (id) => `/api/admin/faqs/${id}`,
    fields: [
      { key: "category", label: "Category" },
      { key: "question", label: "Question" },
      { key: "answer", label: "Answer", long: true },
    ],
  });

  const renderBrochures = crudView({
    title: "brochure",
    listPath: "/api/brochures",
    createPath: "/api/admin/brochures",
    updatePathFn: (id) => `/api/admin/brochures/${id}`,
    deletePathFn: (id) => `/api/admin/brochures/${id}`,
    fields: [
      { key: "title", label: "Title" },
      { key: "description", label: "Description", long: true },
      { key: "price", label: "Price" },
      { key: "pdf_link", label: "PDF link" },
    ],
  });

  const renderQuick = crudView({
    title: "quick answer",
    listPath: "/api/quick-answers",
    createPath: "/api/admin/quick-answers",
    updatePathFn: (id) => `/api/admin/quick-answers/${id}`,
    deletePathFn: (id) => `/api/admin/quick-answers/${id}`,
    fields: [
      { key: "category", label: "Category" },
      { key: "question", label: "Question" },
      { key: "answer", label: "Answer", long: true },
    ],
  });

  // ---------------- PROPOSALS ----------------
  async function renderProposals() {
    content.innerHTML = `<div class="empty">Loading...</div>`;
    const d = await api("/api/admin/proposals");
    content.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead><tr><th>Company</th><th>Topic</th><th>Staff</th><th>Preferred date</th><th>Status</th></tr></thead>
        <tbody>${d.proposals
          .map(
            (p) => `<tr>
              <td>${escapeHtml(p.company_name)}</td><td>${escapeHtml(p.training_topic)}</td>
              <td>${escapeHtml(p.staff_count)}</td><td>${escapeHtml(p.preferred_date)}</td>
              <td><select data-status="${p.id}">
                ${["new", "in_progress", "sent", "closed"].map((s) => `<option value="${s}" ${s === p.status ? "selected" : ""}>${s}</option>`).join("")}
              </select></td>
            </tr>`
          )
          .join("") || `<tr><td colspan="5" class="empty">No proposal requests yet</td></tr>`}
        </tbody>
      </table></div>`;
    content.querySelectorAll("[data-status]").forEach((sel) =>
      sel.addEventListener("change", async () => {
        await api(`/api/admin/proposals/${sel.dataset.status}`, { method: "PUT", body: JSON.stringify({ status: sel.value }) });
        toast("Status updated");
      })
    );
  }

  // ---------------- COMPANY PROFILE ----------------
  async function renderProfile() {
    const d = await api("/api/admins/me");
    const a = d.admin;
    content.innerHTML = `<div class="card" style="max-width:480px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <img id="logoPreview" src="${a.company_logo || ""}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;background:#eee;${a.company_logo ? "" : "display:none;"}" />
        <div><label>Company logo</label><input type="file" id="logoInput" accept="image/*" /></div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <img id="picPreview" src="${a.profile_pic || ""}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;background:#eee;${a.profile_pic ? "" : "display:none;"}" />
        <div><label>Your profile picture</label><input type="file" id="picInput" accept="image/*" /></div>
      </div>
      <div class="field"><label>Your name</label><input id="pName" value="${escapeHtml(a.name || "")}" /></div>
      <div class="field"><label>Company name</label><input id="pCompany" value="${escapeHtml(a.company_name || "")}" /></div>
      <div class="field"><label>Address</label><input id="pAddress" value="${escapeHtml(a.address || "")}" /></div>
      <div class="field"><label>Phone</label><input id="pPhone" value="${escapeHtml(a.phone || "")}" /></div>
      <div class="field"><label>New password (optional)</label><input id="pPassword" type="password" /></div>
      <button class="btn" id="saveProfileBtn">Save changes</button>
    </div>`;

    let newLogo = null, newPic = null;
    async function uploadTo(inputId, previewId, setter) {
      document.getElementById(inputId).addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/uploads/image", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
        const out = await res.json();
        if (out.url) {
          setter(out.url);
          const img = document.getElementById(previewId);
          img.src = out.url;
          img.style.display = "block";
        }
      });
    }
    uploadTo("logoInput", "logoPreview", (url) => (newLogo = url));
    uploadTo("picInput", "picPreview", (url) => (newPic = url));

    document.getElementById("saveProfileBtn").addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("pName").value.trim(),
        company_name: document.getElementById("pCompany").value.trim(),
        address: document.getElementById("pAddress").value.trim(),
        phone: document.getElementById("pPhone").value.trim(),
      };
      if (newLogo) payload.company_logo = newLogo;
      if (newPic) payload.profile_pic = newPic;
      const pw = document.getElementById("pPassword").value;
      if (pw) payload.password = pw;
      const out = await api("/api/admins/me", { method: "PUT", body: JSON.stringify(payload) });
      admin = out.admin;
      companyNameLabel.textContent = admin.company_name;
      adminNameLabel.textContent = admin.name;
      toast("Company profile updated");
    });
  }

  if (token) boot();
})();
