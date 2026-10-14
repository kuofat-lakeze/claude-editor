/* 後台管理介面（純 vanilla JS，無建置步驟） */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $("#view");
  const state = { overview: null, automations: [], channels: [], editing: null, simResult: null };

  /* ---------- 小工具 ---------- */
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmtTime = (s) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleString("zh-TW", { hour12: false }) : "");
  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
  }
  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {
      headers: { "content-type": "application/json" },
      ...opts,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && !path.startsWith("/auth")) {
      showLogin();
      throw new Error("未登入");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /* ---------- 登入 ---------- */
  function showLogin() {
    $("#login").classList.remove("hidden");
    $("#shell").classList.add("hidden");
  }
  function showShell() {
    $("#login").classList.add("hidden");
    $("#shell").classList.remove("hidden");
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#login-error").textContent = "";
    try {
      await api("/auth/login", { method: "POST", body: { password: $("#login-password").value } });
      showShell();
      route();
    } catch (err) {
      $("#login-error").textContent = err.message;
    }
  });
  $("#logout").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    showLogin();
  });

  /* ---------- 路由 ---------- */
  const TRIGGER_LABEL = {
    ad: "指定廣告 ID",
    ref: "ref 參數",
    any_ad: "任何廣告點擊",
    keyword: "關鍵字",
    postback: "按鈕 payload",
    get_started: "開始使用",
    default: "預設回覆",
  };
  const TRIGGER_HELP = {
    ad: "填廣告 ID（可多個，用逗號分隔）。在廣告管理員的廣告層級可看到 ID；Meta 傳 webhook 時會帶 referral.ad_id。",
    ref: "填 ref 值（可多個）。在廣告的「訊息範本 → 進階 → ref 參數」設定，或 m.me/你的專頁?ref=xxx 連結。支援前綴比對。",
    any_ad: "只要是從任何 Meta 廣告點進來（referral.source = ADS）就觸發。適合當廣告的通用接待。",
    keyword: "使用者訊息包含任一關鍵字即觸發（不分大小寫，多個用逗號分隔）。",
    postback: "使用者按下「按鈕 / 快速回覆」時送回的 payload 完全相符即觸發。用來串多步驟流程。",
    get_started: "新用戶第一次按「開始使用」且沒有廣告來源時觸發。",
    default: "以上都沒命中時的兜底回覆（只對一般訊息生效）。",
  };

  function route() {
    const hash = (location.hash || "#overview").slice(1);
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + hash.split("/")[0]));
    const [page, arg] = hash.split("/");
    const pages = { overview, automations, contacts, events, channels, simulate };
    (pages[page] || overview)(arg).catch((err) => {
      if (err.message !== "未登入") toast(err.message, true);
    });
  }
  window.addEventListener("hashchange", route);

  /* ---------- 總覽 ---------- */
  async function overview() {
    const o = await api("/overview");
    state.overview = o;
    const s = o.stats;
    view.innerHTML = `
      <div class="grid">
        ${stat(s.contacts, "總聯絡人")}
        ${stat(s.contacts_from_ads, "來自廣告")}
        ${stat(s.contacts_today, "今日新增")}
        ${stat(s.triggered, "自動化觸發次數")}
        ${stat(s.link_clicks, "導購連結點擊")}
        ${stat(s.automations, "啟用中的自動化")}
      </div>
      <div class="card">
        <h2>Meta Webhook 設定</h2>
        <p>到 <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">Meta 開發者後台</a> → 你的 App → Messenger / Instagram → Webhooks，填入：</p>
        <table>
          <tr><th style="width:160px">回呼網址</th><td><code>${esc(o.webhook_url)}</code></td></tr>
          <tr><th>驗證權杖</th><td><code>${esc(o.verify_token)}</code></td></tr>
          <tr><th>要訂閱的欄位</th><td><code>messages</code> <code>messaging_postbacks</code> <code>messaging_referrals</code> <code>messaging_optins</code></td></tr>
          <tr><th>App Secret 驗簽</th><td>${o.app_secret_configured ? '<span class="badge ok">已啟用</span>' : '<span class="badge warn">未設定 META_APP_SECRET（正式環境請設定）</span>'}</td></tr>
          <tr><th>Graph API 版本</th><td>${esc(o.graph_version)}</td></tr>
        </table>
        ${o.channels.length === 0 ? '<p class="hint">⚠️ 還沒有新增任何頻道。請先到「頻道」頁面加入粉絲專頁或 IG 帳號的存取權杖，否則收到的事件無法回覆。</p>' : ""}
      </div>
      <div class="card">
        <h2>三步驟上線</h2>
        <ol class="steps-guide">
          <li><b>頻道</b>：新增粉絲專頁（或 IG 專業帳號）的 ID 與長效存取權杖。</li>
          <li><b>自動化</b>：建立「任何廣告點擊 → 回覆文字 + 前往按鈕（你的網址）」規則。可用上方「模擬測試」先看效果。</li>
          <li><b>廣告</b>：在廣告管理員建立「訊息」目標（Click to Messenger / Instagram）的廣告。想分流不同廣告，可用「ref 參數」或「廣告 ID」當觸發條件。</li>
        </ol>
      </div>`;
  }
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;

  /* ---------- 自動化列表 / 編輯 ---------- */
  async function automations(arg) {
    [state.automations, state.channels] = await Promise.all([api("/automations"), api("/channels")]);
    if (arg === "new") {
      state.editing = blankAutomation();
      return renderEditor();
    }
    if (arg && arg.startsWith("edit-")) {
      const a = state.automations.find((x) => x.id === Number(arg.slice(5)));
      if (!a) return (location.hash = "#automations");
      state.editing = JSON.parse(JSON.stringify(a));
      return renderEditor();
    }
    state.editing = null;
    const rows = state.automations
      .map(
        (a) => `<tr>
          <td><b>${esc(a.name)}</b><div class="muted small">${a.steps.length} 個步驟 · 優先度 ${a.priority}</div></td>
          <td><span class="badge">${TRIGGER_LABEL[a.trigger_type]}</span>${a.trigger_value ? `<div class="mono small">${esc(a.trigger_value)}</div>` : ""}</td>
          <td>${platformBadge(a.platform)}</td>
          <td>${a.triggered_count}</td>
          <td><label class="switch"><input type="checkbox" data-toggle="${a.id}" ${a.enabled ? "checked" : ""}/> ${a.enabled ? "啟用" : "停用"}</label></td>
          <td class="row">
            <a class="btn small" href="#automations/edit-${a.id}">編輯</a>
            <button class="btn small danger" data-del="${a.id}">刪除</button>
          </td></tr>`,
      )
      .join("");
    view.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <h2 style="margin:0">自動化</h2>
        <div class="row">
          <button class="btn" id="quick-ad">⚡ 快速建立：廣告點擊 → 導購</button>
          <a class="btn primary" href="#automations/new">＋ 新增自動化</a>
        </div>
      </div>
      <div class="card">
        ${rows ? `<table><thead><tr><th>名稱</th><th>觸發條件</th><th>平台</th><th>觸發次數</th><th>狀態</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">還沒有自動化，點右上角新增，或用「快速建立」。</div>'}
      </div>`;
    $("#quick-ad").onclick = () => {
      state.editing = quickAdTemplate();
      renderEditor();
    };
    view.querySelectorAll("[data-toggle]").forEach((el) => {
      el.onchange = async () => {
        await api(`/automations/${el.dataset.toggle}/enabled`, { method: "PATCH", body: { enabled: el.checked } });
        toast(el.checked ? "已啟用" : "已停用");
        automations();
      };
    });
    view.querySelectorAll("[data-del]").forEach((el) => {
      el.onclick = async () => {
        if (!confirm("確定刪除這條自動化？")) return;
        await api(`/automations/${el.dataset.del}`, { method: "DELETE" });
        toast("已刪除");
        automations();
      };
    });
  }

  function blankAutomation() {
    return { name: "", enabled: 1, priority: 0, platform: "any", channel_id: null, trigger_type: "any_ad", trigger_value: "", steps: [{ type: "text", text: "" }] };
  }
  function quickAdTemplate() {
    return {
      name: "廣告點擊 → 導購",
      enabled: 1,
      priority: 10,
      platform: "any",
      channel_id: null,
      trigger_type: "any_ad",
      trigger_value: "",
      steps: [
        { type: "text", text: "{{first_name}} 你好 👋 感謝你對我們的廣告有興趣！" },
        { type: "buttons", text: "點下方按鈕，直接前往了解更多 👇", buttons: [{ type: "url", title: "立即前往", url: "https://", track: true }] },
        { type: "tag", tag: "ad-lead" },
      ],
    };
  }
  const platformBadge = (p) =>
    p === "instagram" ? '<span class="badge ig">Instagram</span>' : p === "messenger" ? '<span class="badge fb">Messenger</span>' : '<span class="badge off">全部</span>';

  function renderEditor() {
    const a = state.editing;
    const isNew = !a.id;
    view.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <h2 style="margin:0">${isNew ? "新增自動化" : "編輯自動化"}</h2>
        <a class="btn ghost" href="#automations">← 回列表</a>
      </div>
      <div class="card">
        <div class="two">
          <label class="field"><span>名稱</span><input type="text" data-path="name" value="${esc(a.name)}" placeholder="例：春季活動廣告接待"/></label>
          <div class="two">
            <label class="field"><span>優先度（大者優先）</span><input type="number" data-path="priority" value="${a.priority}"/></label>
            <label class="field"><span>狀態</span><select data-path="enabled"><option value="1" ${a.enabled ? "selected" : ""}>啟用</option><option value="0" ${!a.enabled ? "selected" : ""}>停用</option></select></label>
          </div>
        </div>
        <div class="two">
          <label class="field"><span>平台</span>
            <select data-path="platform">
              <option value="any" ${a.platform === "any" ? "selected" : ""}>全部</option>
              <option value="messenger" ${a.platform === "messenger" ? "selected" : ""}>Messenger</option>
              <option value="instagram" ${a.platform === "instagram" ? "selected" : ""}>Instagram</option>
            </select></label>
          <label class="field"><span>限定頻道（可不選）</span>
            <select data-path="channel_id">
              <option value="">不限</option>
              ${state.channels.map((c) => `<option value="${c.id}" ${a.channel_id === c.id ? "selected" : ""}>${esc(c.name)}（${c.platform}）</option>`).join("")}
            </select></label>
        </div>
        <h3>觸發條件</h3>
        <div class="two">
          <label class="field"><span>類型</span>
            <select data-path="trigger_type" id="trigger-type">
              ${Object.entries(TRIGGER_LABEL).map(([k, v]) => `<option value="${k}" ${a.trigger_type === k ? "selected" : ""}>${v}</option>`).join("")}
            </select></label>
          <label class="field" id="trigger-value-field"><span>條件值</span><input type="text" data-path="trigger_value" value="${esc(a.trigger_value)}"/></label>
        </div>
        <div class="hint" id="trigger-help"></div>
      </div>

      <div class="card">
        <div class="row between">
          <h2 style="margin:0">回覆步驟</h2>
          <div class="row">
            <select id="add-step-type">
              <option value="text">文字訊息</option>
              <option value="buttons">文字 + 按鈕（導購連結）</option>
              <option value="quick_replies">快速回覆選項</option>
              <option value="image">圖片</option>
              <option value="delay">等待幾秒</option>
              <option value="tag">加上標籤</option>
              <option value="goto">跳到另一條自動化</option>
            </select>
            <button class="btn" id="add-step">＋ 加入步驟</button>
          </div>
        </div>
        <p class="muted small">可用變數：<code>{{first_name}}</code> <code>{{full_name}}</code> <code>{{ad_id}}</code> <code>{{ref}}</code> <code>{{message}}</code></p>
        <div id="steps">${a.steps.map((s, i) => stepHtml(s, i)).join("")}</div>
      </div>

      <div class="two">
        <div class="card">
          <h2>預覽</h2>
          <div class="preview" id="preview">${previewHtml(a.steps)}</div>
        </div>
        <div class="card">
          <h2>儲存</h2>
          <p class="muted small">儲存後立即生效。建議先到「模擬測試」確認會命中這條規則。</p>
          <div class="row">
            <button class="btn primary" id="save">${isNew ? "建立自動化" : "儲存變更"}</button>
            <a class="btn" href="#automations">取消</a>
          </div>
          <p class="error" id="save-error"></p>
        </div>
      </div>`;

    updateTriggerUi();

    $("#add-step").onclick = () => {
      a.steps.push(newStep($("#add-step-type").value));
      renderEditor();
    };
    $("#save").onclick = async () => {
      $("#save-error").textContent = "";
      try {
        const payload = { ...a, enabled: !!a.enabled };
        if (isNew) await api("/automations", { method: "POST", body: payload });
        else await api(`/automations/${a.id}`, { method: "PUT", body: payload });
        toast("已儲存");
        state.editing = null;
        if (location.hash === "#automations" || location.hash === "") automations();
        else location.hash = "#automations";
      } catch (err) {
        $("#save-error").textContent = err.message;
      }
    };
  }

  function updateTriggerUi() {
    const a = state.editing;
    if (!a || !$("#trigger-help")) return;
    const t = a.trigger_type;
    $("#trigger-help").textContent = TRIGGER_HELP[t];
    $("#trigger-value-field").style.visibility = ["ad", "ref", "keyword", "postback"].includes(t) ? "visible" : "hidden";
  }

  /* 編輯器的事件委派只掛一次，避免每次重繪都重複掛監聽 */
  const editorOpen = () => state.editing && $("#steps");
  function onEditorField(e) {
    if (!editorOpen()) return;
    const a = state.editing;
    const el = e.target;
    if (!el.dataset.path) return;
    let val = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number") val = Number(val);
    if (el.dataset.path === "enabled") val = Number(val);
    if (el.dataset.path === "channel_id") val = val === "" ? null : Number(val);
    if (el.dataset.path.endsWith(".automation_id")) val = Number(val);
    setPath(a, el.dataset.path, val);
    if (el.dataset.path === "trigger_type") updateTriggerUi();
    $("#preview").innerHTML = previewHtml(a.steps);
  }
  view.addEventListener("input", onEditorField);
  view.addEventListener("change", onEditorField);
  view.addEventListener("click", (e) => {
    if (!editorOpen()) return;
    const a = state.editing;
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const i = Number(b.dataset.i);
    const j = Number(b.dataset.j);
    switch (b.dataset.act) {
      case "rm-step": a.steps.splice(i, 1); break;
      case "up": if (i > 0) [a.steps[i - 1], a.steps[i]] = [a.steps[i], a.steps[i - 1]]; break;
      case "down": if (i < a.steps.length - 1) [a.steps[i + 1], a.steps[i]] = [a.steps[i], a.steps[i + 1]]; break;
      case "add-btn": if (a.steps[i].buttons.length < 3) a.steps[i].buttons.push({ type: "url", title: "", url: "https://", track: true }); break;
      case "rm-btn": a.steps[i].buttons.splice(j, 1); break;
      case "add-qr": a.steps[i].replies.push({ title: "", payload: "" }); break;
      case "rm-qr": a.steps[i].replies.splice(j, 1); break;
      case "btn-type": a.steps[i].buttons[j] = b.dataset.v === "postback" ? { type: "postback", title: a.steps[i].buttons[j].title, payload: "" } : { type: "url", title: a.steps[i].buttons[j].title, url: "https://", track: true }; break;
      default: return;
    }
    renderEditor();
  });

  function setPath(obj, path, val) {
    const keys = path.split(".");
    let o = obj;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = val;
  }
  function newStep(type) {
    return {
      text: { type: "text", text: "" },
      buttons: { type: "buttons", text: "", buttons: [{ type: "url", title: "立即前往", url: "https://", track: true }] },
      quick_replies: { type: "quick_replies", text: "", replies: [{ title: "", payload: "" }] },
      image: { type: "image", url: "https://" },
      delay: { type: "delay", seconds: 2 },
      tag: { type: "tag", tag: "" },
      goto: { type: "goto", automation_id: state.automations[0]?.id ?? 0 },
    }[type];
  }
  const STEP_LABEL = { text: "文字訊息", buttons: "文字 + 按鈕", quick_replies: "快速回覆", image: "圖片", delay: "等待", tag: "加標籤", goto: "跳轉自動化" };

  function stepHtml(s, i) {
    const p = (k) => `steps.${i}.${k}`;
    let body = "";
    switch (s.type) {
      case "text":
        body = `<textarea data-path="${p("text")}" placeholder="要回覆的文字">${esc(s.text)}</textarea>`;
        break;
      case "buttons":
        body = `<textarea data-path="${p("text")}" placeholder="按鈕上方的文字">${esc(s.text)}</textarea>
          <div style="margin-top:8px">${s.buttons
            .map(
              (b, j) => `<div class="btn-row">
                <input type="text" data-path="${p(`buttons.${j}.title`)}" value="${esc(b.title)}" placeholder="按鈕文字（最多 20 字）" maxlength="20"/>
                ${b.type === "postback"
                  ? `<input type="text" data-path="${p(`buttons.${j}.payload`)}" value="${esc(b.payload)}" placeholder="payload（給「按鈕 payload」觸發用）"/>`
                  : `<input type="url" data-path="${p(`buttons.${j}.url`)}" value="${esc(b.url)}" placeholder="https://你要導去的網址"/>`}
                <select data-act="btn-type" data-i="${i}" data-j="${j}" data-v="" onchange="this.dataset.v=this.value;this.click()">
                  <option value="url" ${b.type === "url" ? "selected" : ""}>開網址</option>
                  <option value="postback" ${b.type === "postback" ? "selected" : ""}>回傳 payload</option>
                </select>
                <button class="btn small danger" data-act="rm-btn" data-i="${i}" data-j="${j}">✕</button>
                ${b.type === "url" ? `<label class="switch small" style="grid-column:1/-1"><input type="checkbox" data-path="${p(`buttons.${j}.track`)}" ${b.track !== false ? "checked" : ""}/> 使用追蹤連結（可統計點擊，使用者會先經過本系統再轉址）</label>` : ""}
              </div>`,
            )
            .join("")}
            ${s.buttons.length < 3 ? `<button class="btn small" data-act="add-btn" data-i="${i}">＋ 按鈕（最多 3 個）</button>` : ""}
          </div>`;
        break;
      case "quick_replies":
        body = `<textarea data-path="${p("text")}" placeholder="問題文字">${esc(s.text)}</textarea>
          <div style="margin-top:8px">${s.replies
            .map(
              (r, j) => `<div class="btn-row" style="grid-template-columns:1fr 1fr auto">
                <input type="text" data-path="${p(`replies.${j}.title`)}" value="${esc(r.title)}" placeholder="選項文字" maxlength="20"/>
                <input type="text" data-path="${p(`replies.${j}.payload`)}" value="${esc(r.payload)}" placeholder="payload（留空＝同選項文字）"/>
                <button class="btn small danger" data-act="rm-qr" data-i="${i}" data-j="${j}">✕</button>
              </div>`,
            )
            .join("")}
            <button class="btn small" data-act="add-qr" data-i="${i}">＋ 選項</button>
          </div>`;
        break;
      case "image":
        body = `<input type="url" data-path="${p("url")}" value="${esc(s.url)}" placeholder="https://圖片網址.jpg"/>`;
        break;
      case "delay":
        body = `<div class="row">等待 <input type="number" min="0" max="15" style="width:90px" data-path="${p("seconds")}" value="${s.seconds}"/> 秒再送下一步（最多 15 秒）</div>`;
        break;
      case "tag":
        body = `<input type="text" data-path="${p("tag")}" value="${esc(s.tag)}" placeholder="例：ad-lead"/>`;
        break;
      case "goto":
        body = `<select data-path="${p("automation_id")}">${state.automations
          .filter((x) => x.id !== state.editing.id)
          .map((x) => `<option value="${x.id}" ${x.id === s.automation_id ? "selected" : ""}>${esc(x.name)}</option>`)
          .join("")}</select>`;
        break;
    }
    return `<div class="step">
      <div class="step-head"><b>${i + 1}. ${STEP_LABEL[s.type]}</b>
        <span class="row">
          <button class="btn small ghost" data-act="up" data-i="${i}" title="上移">↑</button>
          <button class="btn small ghost" data-act="down" data-i="${i}" title="下移">↓</button>
          <button class="btn small danger" data-act="rm-step" data-i="${i}">刪除</button>
        </span></div>
      ${body}</div>`;
  }

  function previewHtml(steps) {
    const demo = (t) => esc(String(t).replace(/\{\{\s*(first_name|full_name)\s*\}\}/g, "小明").replace(/\{\{[^}]*\}\}/g, ""));
    const out = steps
      .map((s) => {
        switch (s.type) {
          case "text": return `<div class="bubble">${demo(s.text) || "<span class='muted'>（空白）</span>"}</div>`;
          case "buttons": return `<div class="bubble">${demo(s.text)}${s.buttons.map((b) => `<span class="pbtn">${demo(b.title) || "按鈕"}</span>`).join("")}</div>`;
          case "quick_replies": return `<div class="bubble">${demo(s.text)}</div><div class="chips">${s.replies.map((r) => `<span class="chip">${demo(r.title) || "選項"}</span>`).join("")}</div>`;
          case "image": return `<div class="bubble">🖼 ${esc(s.url)}</div>`;
          case "delay": return `<div class="muted small" style="margin:4px 0">⏱ 等待 ${s.seconds} 秒</div>`;
          case "tag": return `<div class="muted small" style="margin:4px 0">🏷 加標籤「${esc(s.tag)}」</div>`;
          case "goto": return `<div class="muted small" style="margin:4px 0">↪ 跳到自動化 #${s.automation_id}</div>`;
        }
      })
      .join("");
    return out || '<div class="muted">尚無步驟</div>';
  }

  /* ---------- 聯絡人 ---------- */
  async function contacts(arg) {
    if (arg) {
      const { contact: c, events: evs } = await api(`/contacts/${arg}`);
      view.innerHTML = `
        <div class="row between" style="margin-bottom:12px"><h2 style="margin:0">${esc([c.first_name, c.last_name].filter(Boolean).join(" ") || c.psid)}</h2><a class="btn ghost" href="#contacts">← 回列表</a></div>
        <div class="two">
          <div class="card">
            <table>
              <tr><th>平台</th><td>${platformBadge(c.platform)}</td></tr>
              <tr><th>PSID</th><td class="mono">${esc(c.psid)}</td></tr>
              <tr><th>來源廣告 ID</th><td>${esc(c.source_ad_id) || "—"}</td></tr>
              <tr><th>來源 ref</th><td>${esc(c.source_ref) || "—"}</td></tr>
              <tr><th>標籤</th><td>${c.tags.map((t) => `<span class="badge">${esc(t)}</span> `).join("") || "—"}</td></tr>
              <tr><th>首次互動</th><td>${fmtTime(c.first_seen)}</td></tr>
              <tr><th>最近互動</th><td>${fmtTime(c.last_seen)}</td></tr>
            </table>
            <h3>手動發送訊息</h3>
            <p class="muted small">僅限對方最後一次互動 24 小時內。</p>
            <div class="row"><input type="text" id="manual-text" placeholder="訊息內容" style="flex:1"/><button class="btn primary" id="manual-send">送出</button></div>
          </div>
          <div class="card"><h2>互動記錄</h2>${eventTable(evs)}</div>
        </div>`;
      $("#manual-send").onclick = async () => {
        try {
          await api(`/contacts/${c.id}/send`, { method: "POST", body: { text: $("#manual-text").value } });
          toast("已送出");
          contacts(arg);
        } catch (err) {
          toast(err.message, true);
        }
      };
      return;
    }
    const list = await api("/contacts");
    view.innerHTML = `<h2>聯絡人</h2><div class="card">${
      list.length
        ? `<table><thead><tr><th>名稱</th><th>平台</th><th>來源</th><th>標籤</th><th>最近互動</th><th></th></tr></thead><tbody>${list
            .map(
              (c) => `<tr>
              <td><a href="#contacts/${c.id}"><b>${esc([c.first_name, c.last_name].filter(Boolean).join(" ") || c.psid)}</b></a></td>
              <td>${platformBadge(c.platform)}</td>
              <td>${c.source_ad_id ? `<span class="badge ok">廣告 ${esc(c.source_ad_id)}</span>` : c.source_ref ? `<span class="badge">ref ${esc(c.source_ref)}</span>` : '<span class="muted">自然流量</span>'}</td>
              <td>${c.tags.map((t) => `<span class="badge off">${esc(t)}</span>`).join(" ")}</td>
              <td class="small">${fmtTime(c.last_seen)}</td>
              <td><button class="btn small danger" data-del="${c.id}">刪除</button></td></tr>`,
            )
            .join("")}</tbody></table>`
        : '<div class="empty">還沒有聯絡人。設定好 Webhook 與頻道後，有人傳訊息就會出現在這裡。</div>'
    }</div>`;
    view.querySelectorAll("[data-del]").forEach((el) => {
      el.onclick = async () => {
        if (!confirm("刪除此聯絡人？")) return;
        await api(`/contacts/${el.dataset.del}`, { method: "DELETE" });
        contacts();
      };
    });
  }

  /* ---------- 記錄 ---------- */
  const TYPE_BADGE = { error: "err", warning: "warn", sent: "ok", click: "ok", automation: "", message: "off", postback: "off", referral: "" };
  function eventTable(evs) {
    if (!evs.length) return '<div class="empty">目前沒有記錄</div>';
    return `<table><thead><tr><th style="width:150px">時間</th><th style="width:90px">類型</th><th>內容</th></tr></thead><tbody>${evs
      .map(
        (e) => `<tr><td class="small">${fmtTime(e.created_at)}</td><td><span class="badge ${TYPE_BADGE[e.type] ?? ""}">${esc(e.type)}</span></td>
        <td>${esc(e.summary)}${e.contact_id ? ` <a class="small" href="#contacts/${e.contact_id}">聯絡人 #${e.contact_id}</a>` : ""}
        ${e.payload ? `<details><summary>原始資料</summary><pre class="json">${esc(JSON.stringify(JSON.parse(e.payload), null, 2))}</pre></details>` : ""}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  }
  async function events() {
    const [evs, lk] = await Promise.all([api("/events"), api("/links")]);
    view.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><h2 style="margin:0">記錄</h2><button class="btn" id="refresh">重新整理</button></div>
      <div class="card">${eventTable(evs)}</div>
      <div class="card"><h2>追蹤連結</h2>${
        lk.length
          ? `<table><thead><tr><th>追蹤網址</th><th>目的地</th><th>點擊</th></tr></thead><tbody>${lk.map((l) => `<tr><td class="mono small">/r/${esc(l.slug)}</td><td class="small">${esc(l.url)}</td><td>${l.clicks}</td></tr>`).join("")}</tbody></table>`
          : '<p class="muted">尚無追蹤連結（使用「文字 + 按鈕」步驟並勾選追蹤後會自動產生）。</p>'
      }</div>`;
    $("#refresh").onclick = events;
  }

  /* ---------- 頻道 ---------- */
  async function channels() {
    const list = await api("/channels");
    view.innerHTML = `
      <h2>頻道</h2>
      <div class="card">
        ${list.length
          ? `<table><thead><tr><th>名稱</th><th>平台</th><th>ID</th><th>權杖</th><th></th></tr></thead><tbody>${list
              .map(
                (c) => `<tr><td><b>${esc(c.name)}</b></td><td>${platformBadge(c.platform)}${c.instagram_login ? ' <span class="badge off">IG 登入</span>' : ""}</td>
                <td class="mono">${esc(c.external_id)}</td><td class="mono small">${esc(c.access_token)}</td>
                <td class="row"><button class="btn small" data-test="${c.id}">測試權杖</button><button class="btn small danger" data-del="${c.id}">刪除</button></td></tr>`,
              )
              .join("")}</tbody></table>`
          : '<div class="empty">尚未新增頻道</div>'}
      </div>
      <div class="card">
        <h2>新增 / 更新頻道</h2>
        <div class="hint">
          <b>Messenger：</b>ID 填粉絲專頁 ID，權杖填「粉絲專頁存取權杖」（建議用系統用戶產生永不過期的權杖）。<br/>
          <b>Instagram：</b>ID 填 IG 專業帳號 ID（Webhook 的 entry.id）。若權杖是透過「Facebook 登入」取得，用粉絲專頁權杖即可；若是「Instagram 登入」取得的權杖，請勾選下方選項。<br/>
          同一個 ID 再送一次會更新資料；權杖留空則保留原本的。
        </div>
        <div class="three">
          <label class="field"><span>平台</span><select id="ch-platform"><option value="messenger">Messenger（粉絲專頁）</option><option value="instagram">Instagram</option></select></label>
          <label class="field"><span>粉絲專頁 ID / IG 帳號 ID</span><input type="text" id="ch-id" placeholder="1234567890"/></label>
          <label class="field"><span>顯示名稱</span><input type="text" id="ch-name" placeholder="我的品牌"/></label>
        </div>
        <label class="field"><span>存取權杖</span><input type="password" id="ch-token" placeholder="EAAB..."/></label>
        <label class="switch"><input type="checkbox" id="ch-iglogin"/> 這是用「Instagram 登入」取得的權杖（走 graph.instagram.com）</label>
        <div style="margin-top:12px"><button class="btn primary" id="ch-save">儲存頻道</button></div>
      </div>`;
    $("#ch-save").onclick = async () => {
      try {
        await api("/channels", {
          method: "POST",
          body: {
            platform: $("#ch-platform").value,
            external_id: $("#ch-id").value,
            name: $("#ch-name").value,
            access_token: $("#ch-token").value,
            instagram_login: $("#ch-iglogin").checked,
          },
        });
        toast("已儲存頻道");
        channels();
      } catch (err) {
        toast(err.message, true);
      }
    };
    view.querySelectorAll("[data-test]").forEach((el) => {
      el.onclick = async () => {
        el.disabled = true;
        try {
          const r = await api(`/channels/${el.dataset.test}/test`, { method: "POST" });
          toast(`權杖有效：${r.result.name || r.result.id}`);
        } catch (err) {
          toast("權杖無效：" + err.message, true);
        }
        el.disabled = false;
      };
    });
    view.querySelectorAll("[data-del]").forEach((el) => {
      el.onclick = async () => {
        if (!confirm("刪除此頻道？")) return;
        await api(`/channels/${el.dataset.del}`, { method: "DELETE" });
        channels();
      };
    });
  }

  /* ---------- 模擬測試 ---------- */
  async function simulate() {
    view.innerHTML = `
      <h2>模擬測試</h2>
      <div class="two">
        <div class="card">
          <p class="muted small">模擬一個使用者「從廣告點進來」或「傳訊息」，看看會命中哪條自動化、送出什麼內容。不會真的發訊息。</p>
          <label class="field"><span>平台</span><select id="sim-platform"><option value="messenger">Messenger</option><option value="instagram">Instagram</option></select></label>
          <label class="field"><span>廣告 ID（模擬從廣告點進來）</span><input type="text" id="sim-ad" placeholder="例：120211234567890"/></label>
          <label class="field"><span>ref 參數</span><input type="text" id="sim-ref" placeholder="例：spring_sale"/></label>
          <label class="field"><span>使用者傳的訊息</span><input type="text" id="sim-text" placeholder="例：我想了解價格"/></label>
          <label class="field"><span>按鈕 payload</span><input type="text" id="sim-payload" placeholder="例：WANT_PRICE"/></label>
          <button class="btn primary" id="sim-run">▶ 執行模擬</button>
        </div>
        <div class="card">
          <h2>結果</h2>
          <div id="sim-result" class="muted">尚未執行</div>
        </div>
      </div>`;
    $("#sim-run").onclick = async () => {
      const r = await api("/simulate", {
        method: "POST",
        body: {
          platform: $("#sim-platform").value,
          ad_id: $("#sim-ad").value.trim(),
          ref: $("#sim-ref").value.trim(),
          text: $("#sim-text").value.trim(),
          postback_payload: $("#sim-payload").value.trim(),
        },
      });
      const box = $("#sim-result");
      if (!r.matched) {
        box.innerHTML = '<span class="badge warn">沒有命中任何自動化</span><p class="muted small">檢查觸發條件、平台限制，或新增一條「預設回覆」。</p>';
        return;
      }
      box.innerHTML = `<p>命中：<span class="badge ok">${esc(r.matched.name)}</span></p>
        <div class="preview">${r.messages.map(renderOutgoing).join("")}</div>
        <details><summary>送給 Graph API 的原始 JSON</summary><pre class="json">${esc(JSON.stringify(r.messages, null, 2))}</pre></details>`;
    };
  }
  function renderOutgoing(m) {
    if (m.attachment?.type === "template") {
      const p = m.attachment.payload;
      return `<div class="bubble">${esc(p.text)}${(p.buttons || []).map((b) => `<a class="pbtn" href="${esc(b.url || "#")}" target="_blank" rel="noopener">${esc(b.title)}${b.url ? " ↗" : ""}</a>`).join("")}</div>`;
    }
    if (m.attachment?.type === "image") return `<div class="bubble"><img src="${esc(m.attachment.payload.url)}" style="max-width:100%;border-radius:8px"/></div>`;
    let html = `<div class="bubble">${esc(m.text)}</div>`;
    if (m.quick_replies) html += `<div class="chips">${m.quick_replies.map((q) => `<span class="chip">${esc(q.title)}</span>`).join("")}</div>`;
    return html;
  }

  /* ---------- 啟動 ---------- */
  (async () => {
    try {
      const me = await api("/auth/me");
      if (me.authenticated) {
        showShell();
        route();
      } else showLogin();
    } catch {
      showLogin();
    }
  })();
})();
