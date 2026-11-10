// Overlay on localhost pages: pick an element or draw a box, write or speak a prompt, send it to Claude Code.
(() => {
  if (window.__pointAndPrompt) return;
  window.__pointAndPrompt = true;

  const LIMITS = { text: 4000, html: 6000, elements: 40, elementText: 300 };
  const MIN_BOX = 8;

  const state = {
    active: false,
    mode: "element", // "element" | "box"
    hoverEl: null,
    selection: null, // { mode, el?, rect, scrollX, scrollY }
    drag: null, // { startX, startY }
    recognition: null,
    sessions: [], // [{ port, cwd, project }]
    target: null, // the session this page sends to
  };
  // The choice is remembered per page origin (e.g. localhost:3000) by project folder, because ports change on restart.
  const STORE_KEY = `pnp:session:${location.origin}`;

  // ---------- UI (Shadow DOM so page CSS cannot touch it) ----------
  const host = document.createElement("div");
  host.id = "point-and-prompt-host";
  host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
  // Closed, so page scripts cannot reach the textarea and send button through host.shadowRoot and send prompts themselves.
  const root = host.attachShadow({ mode: "closed" });
  // Mascot "Pip", same drawing as extension/icons/icon.svg (gradient ids prefixed to stay unique).
  const PIP = `
    <svg class="pip" viewBox="0 0 128 128" aria-hidden="true">
      <defs>
        <linearGradient id="pnp-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#ec4899"/>
        </linearGradient>
      </defs>
      <path d="M64 0v36" stroke="#c4b5fd" stroke-width="4" stroke-linecap="round"/>
      <g fill="none" stroke="#8b5cf6" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M42 56L24 38l-14 6"/><path d="M36 68L16 60 5 72"/><path d="M36 80l-18 4-8 16"/><path d="M44 92l-12 12-2 16"/>
        <path d="M86 56l16-18 8-14"/><path d="M92 68l20-8 11 12"/><path d="M92 80l14 4"/><path d="M84 92l8 8"/>
      </g>
      <circle cx="64" cy="70" r="34" fill="url(#pnp-body)"/>
      <ellipse cx="51" cy="66" rx="10.5" ry="12.5" fill="#fff"/><ellipse cx="77" cy="66" rx="10.5" ry="12.5" fill="#fff"/>
      <circle class="eye" cx="53" cy="68" r="6.5" fill="#1e1b4b"/><circle class="eye" cx="79" cy="68" r="6.5" fill="#1e1b4b"/>
      <circle cx="55.5" cy="65" r="2.4" fill="#fff"/><circle cx="81.5" cy="65" r="2.4" fill="#fff"/>
      <path d="M56 85q8 7 16 0" stroke="#1e1b4b" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M94 92l28 11-12 5-5 12z" fill="#fff" stroke="#1e1b4b" stroke-width="4" stroke-linejoin="round"/>
      <path class="twinkle" d="M116 6l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#fbbf24"/>
    </svg>`;

  root.innerHTML = `
    <style>
      :host { --violet: #8b5cf6; --pink: #ec4899; --gold: #fbbf24; --ink: #1e1b4b; --mist: #f5f3ff;
              --grad: linear-gradient(135deg, #a78bfa, #ec4899); --spring: cubic-bezier(.34, 1.56, .64, 1); }
      * { box-sizing: border-box; font-family: "Nunito", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
      .pip { width: 100%; height: 100%; display: block; overflow: visible; }
      .twinkle { transform-origin: 116px 18px; animation: twinkle 2.4s ease-in-out infinite; }

      /* Selection frames */
      .hl { position: fixed; border: 2px dashed var(--violet); background: rgba(139, 92, 246, .08); border-radius: 10px;
            pointer-events: none; display: none; transition: all 60ms ease-out; }
      .hl.sel { border: 2px solid transparent; background: rgba(236, 72, 153, .05);
                box-shadow: 0 0 0 4px rgba(236, 72, 153, .15), 0 0 24px rgba(167, 139, 250, .45);
                transition: none; animation: glow 600ms ease-out; }
      /* Gradient ring only: the mask cuts out the middle, so the page stays visible inside the frame. */
      .hl.sel::before { content: ""; position: absolute; inset: -2px; padding: 2px; border-radius: inherit; background: var(--grad);
                        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                        -webkit-mask-composite: xor; mask-composite: exclude; }
      /* Elements found inside a box selection */
      .marks { position: fixed; inset: 0; pointer-events: none; }
      .mark { position: fixed; border: 1.5px solid var(--pink); border-radius: 6px; background: rgba(236, 72, 153, .1);
              animation: pop 260ms var(--spring); }
      .label { position: absolute; left: -2px; top: -26px; background: var(--ink); color: #fff; font-size: 11px; font-weight: 700;
               padding: 3px 9px; border-radius: 999px; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
      .hl.sel .label { background: var(--grad); }

      /* Toolbox */
      .bar { position: fixed; right: 18px; bottom: 18px; display: none; gap: 6px; align-items: center; pointer-events: auto;
             background: rgba(30, 27, 75, .92); backdrop-filter: blur(10px); color: #ede9fe; padding: 6px 8px 6px 6px;
             border-radius: 999px; border: 1px solid rgba(167, 139, 250, .35); font-size: 12px;
             box-shadow: 0 10px 30px rgba(30, 27, 75, .35), inset 0 1px 0 rgba(255, 255, 255, .08); }
      .bar.show { display: flex; animation: rise 420ms var(--spring); }
      .bar .avatar { width: 34px; height: 34px; position: relative; animation: float 3.2s ease-in-out infinite; }
      .dot { position: absolute; right: -1px; bottom: 1px; width: 10px; height: 10px; border-radius: 50%; background: #a8a29e;
             border: 2px solid var(--ink); }
      .dot.ok { background: #4ade80; box-shadow: 0 0 8px #4ade80; } .dot.err { background: #f87171; }
      .dot.warn { background: var(--gold); box-shadow: 0 0 8px var(--gold); }
      .picker { gap: 4px !important; padding: 6px 8px !important; }
      .picker .caret { width: 10px; height: 10px; opacity: .7; }
      .menu { position: absolute; left: 0; bottom: calc(100% + 8px); min-width: 240px; max-width: 360px; display: none;
              background: rgba(30, 27, 75, .96); border: 1px solid rgba(167, 139, 250, .35); border-radius: 16px; padding: 6px;
              box-shadow: 0 14px 40px rgba(30, 27, 75, .4); }
      .menu.show { display: block; animation: rise 300ms var(--spring); }
      .menu .title { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #a5b4fc; padding: 6px 10px 4px; }
      .bar .menu button { width: 100%; box-sizing: border-box; flex-direction: column; align-items: flex-start !important; gap: 1px !important;
                     border-radius: 12px !important; padding: 7px 10px !important; }
      .bar .menu button.on { background: var(--grad); color: #fff; }
      .menu small { font-size: 10px; font-weight: 600; opacity: .7; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .menu .empty { font-size: 12px; color: #c4b5fd; padding: 8px 10px; line-height: 1.4; }
      .menu code { font: 600 11px ui-monospace, Consolas, monospace; color: #fbcfe8; }
      .status { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c4b5fd; padding: 0 4px; font-weight: 600; }
      .tools { position: relative; display: flex; gap: 2px; background: rgba(255, 255, 255, .06); padding: 3px; border-radius: 999px; }
      /* Liquid slider: the leading edge moves first, the trailing edge follows, so it stretches like water. */
      .slider { position: absolute; top: 3px; bottom: 3px; left: var(--l, 3px); right: var(--r, 50%); border-radius: 999px;
                background: linear-gradient(90deg, #a78bfa, #ec4899, #f472b6, #a78bfa); background-size: 300% 100%;
                box-shadow: 0 4px 12px rgba(236, 72, 153, .35); animation: flow 4s linear infinite;
                transition: left 460ms var(--spring) var(--dl, 0ms), right 460ms var(--spring) var(--dr, 0ms); }
      .slider.still { transition: none; }
      .bar button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 6px 10px;
                    border-radius: 999px; color: #ddd6fe; font-weight: 700; transition: background 150ms, transform 150ms var(--spring); }
      .bar button:hover { background: rgba(255, 255, 255, .1); transform: translateY(-1px); }
      .tools button { position: relative; z-index: 1; }
      .tools button.on, .tools button.on:hover { background: transparent; color: #fff; }
      .bar svg.ico { width: 15px; height: 15px; }
      kbd { font: 700 10px/1 ui-monospace, Consolas, monospace; padding: 2px 5px; border-radius: 5px;
            background: rgba(255, 255, 255, .14); color: inherit; }
      .bar .close { padding: 6px 8px; color: #a5b4fc; }

      /* Popover */
      .pop { position: fixed; display: none; width: 380px; pointer-events: auto; padding: 12px; border-radius: 18px; color: var(--ink);
             background: linear-gradient(#fff, var(--mist)) padding-box, var(--grad) border-box; border: 2px solid transparent;
             box-shadow: 0 18px 50px rgba(76, 29, 149, .28); transform-origin: top left; }
      .pop.show { display: block; animation: pop 320ms var(--spring); }
      .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .head .avatar { width: 28px; height: 28px; }
      .head .what { font-size: 12px; font-weight: 800; color: #6d28d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pop textarea { width: 100%; min-height: 76px; resize: vertical; border: 1.5px solid #ddd6fe; border-radius: 12px;
                      padding: 10px 12px; font-size: 14px; line-height: 1.45; outline: none; color: var(--ink); background: #fff;
                      transition: border-color 150ms, box-shadow 150ms; }
      .pop textarea:focus { border-color: var(--violet); box-shadow: 0 0 0 4px rgba(139, 92, 246, .15); }
      .pop textarea::placeholder { color: #a78bfa; }
      .row { display: flex; gap: 6px; margin-top: 10px; align-items: center; }
      .row .hint { flex: 1; font-size: 11px; color: #7c3aed; opacity: .8; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
      .row .hint kbd { background: #ede9fe; color: #6d28d9; }
      .pop button { all: unset; cursor: pointer; font-size: 13px; font-weight: 800; padding: 7px 14px; border-radius: 999px;
                    transition: transform 150ms var(--spring), box-shadow 150ms; }
      .pop button:hover { transform: translateY(-1px); }
      .send { background: var(--grad); color: #fff; box-shadow: 0 6px 16px rgba(236, 72, 153, .35); }
      .send[disabled] { opacity: .55; cursor: default; transform: none; }
      .cancel { color: #6d28d9; } .cancel:hover { background: #ede9fe; }
      .mic { color: #6d28d9; padding: 7px 10px !important; } .mic:hover { background: #ede9fe; }
      .mic.rec { background: #fee2e2; color: #b91c1c; animation: pulse 1.2s ease-in-out infinite; }

      /* Feedback */
      .toast { position: fixed; left: 0; right: 0; margin: 0 auto; width: fit-content; bottom: 80px; display: none; align-items: center; gap: 10px;
               background: rgba(30, 27, 75, .95); color: #fff; padding: 8px 16px 8px 8px; border-radius: 999px; font-size: 13px;
               font-weight: 700; pointer-events: none; max-width: 80vw; box-shadow: 0 10px 30px rgba(30, 27, 75, .35); }
      .toast.show { display: flex; animation: rise 380ms var(--spring); }
      .toast .badge { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--grad); }
      .toast .badge svg { width: 15px; height: 15px; }
      .toast .badge path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: draw 400ms 150ms ease-out forwards; }
      .toast.err { background: #7f1d1d; } .toast.err .badge { background: #ef4444; }
      .toast.warn .badge { background: linear-gradient(135deg, #fbbf24, #f97316); }
      .hop { animation: hop 520ms var(--spring); }

      @keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.96); } }
      @keyframes pop { from { opacity: 0; transform: scale(.9) translateY(-6px); } }
      @keyframes float { 50% { transform: translateY(-3px) rotate(-3deg); } }
      @keyframes twinkle { 50% { transform: scale(.6) rotate(45deg); opacity: .6; } }
      @keyframes glow { from { box-shadow: 0 0 0 0 rgba(236, 72, 153, .5), 0 0 0 rgba(167, 139, 250, 0); } }
      @keyframes pulse { 50% { box-shadow: 0 0 0 5px rgba(239, 68, 68, .2); } }
      @keyframes flow { to { background-position: 300% 0; } }
      @keyframes draw { to { stroke-dashoffset: 0; } }
      @keyframes hop { 40% { transform: translateY(-8px) rotate(-8deg); } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    </style>
    <div class="hl" id="hover"><span class="label"></span></div>
    <div class="marks" id="marks"></div>
    <div class="hl sel" id="sel"><span class="label"></span></div>
    <div class="bar" id="bar">
      <div class="avatar" id="avatar" title="point-and-prompt">${PIP}<span class="dot" id="dot"></span></div>
      <button class="picker" id="picker" title="Claude-Session wählen">
        <span class="status" id="status">verbinde …</span>
        <svg class="caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7.5l3-3 3 3"/></svg>
      </button>
      <div class="menu" id="menu"></div>
      <div class="tools" id="tools">
        <span class="slider still" id="slider"></span>
        <button id="modeEl" title="Element anklicken">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M5 3l14 7-6 2-2 6z"/></svg>
          Element <kbd>E</kbd>
        </button>
        <button id="modeBox" title="Kasten ziehen">
          <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="3 3"><rect x="3" y="5" width="18" height="14" rx="3"/></svg>
          Kasten <kbd>B</kbd>
        </button>
      </div>
      <button class="close" id="close" title="Ausschalten (Esc oder Alt+Shift+P)">✕</button>
    </div>
    <div class="pop" id="pop">
      <div class="head"><div class="avatar">${PIP}</div><span class="what" id="what"></span></div>
      <textarea id="input" placeholder="Was soll hier passieren?"></textarea>
      <div class="row">
        <span class="hint" title="Enter sendet, Shift+Enter macht eine neue Zeile, Esc bricht ab"><kbd>↵</kbd> senden · <kbd>⇧↵</kbd> Zeile</span>
        <button class="mic" id="mic" title="Diktieren (Chrome sendet Sprache zur Erkennung an Google)">🎤</button>
        <button class="cancel" id="cancel">Abbrechen</button>
        <button class="send" id="send">Senden ✦</button>
      </div>
    </div>
    <div class="toast" id="toast"><span class="badge" id="badge"></span><span id="toastText"></span></div>
  `;
  const $ = (id) => root.getElementById(id);
  const ui = {
    hover: $("hover"), sel: $("sel"), marks: $("marks"), bar: $("bar"), dot: $("dot"), status: $("status"),
    modeEl: $("modeEl"), modeBox: $("modeBox"), close: $("close"),
    pop: $("pop"), input: $("input"), mic: $("mic"), cancel: $("cancel"), send: $("send"), what: $("what"),
    picker: $("picker"), menu: $("menu"), tools: $("tools"), slider: $("slider"), toast: $("toast"), toastText: $("toastText"), badge: $("badge"), avatar: $("avatar"),
  };

  // ---------- helpers ----------
  const isOurs = (event) => event.composedPath().includes(host);
  const clip = (s, max) => (s.length > max ? `${s.slice(0, max)} …` : s);
  const cleanText = (s) => (s || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();

  function cssEscape(s) {
    return window.CSS?.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  /** Short, readable selector: stops at the nearest id, otherwise tag + classes + nth-of-type, max 5 levels. */
  function selectorFor(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 5) {
      if (node.id) {
        parts.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => !c.includes(":") && c.length < 30).slice(0, 2);
      if (classes.length) part += classes.map((c) => `.${cssEscape(c)}`).join("");
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function placeBox(box, rect, label) {
    box.style.display = "block";
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    const lab = box.querySelector(".label");
    lab.textContent = label || "";
    lab.style.display = label ? "block" : "none";
    lab.style.top = rect.y < 24 ? `${rect.height + 2}px` : "-22px";
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += `.${cls.join(".")}`;
    return s;
  }

  const BADGES = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M12 6v8M12 18v.5"/></svg>',
    err: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  };

  let toastTimer;
  function toast(text, kind = "ok") {
    ui.toastText.textContent = text;
    ui.badge.innerHTML = BADGES[kind];
    ui.toast.className = `toast ${kind}`;
    void ui.toast.offsetWidth; // restart the entry animation when toasts follow each other
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), kind === "ok" ? 2800 : 6000);
  }

  function hop() {
    ui.avatar.classList.remove("hop");
    void ui.avatar.offsetWidth;
    ui.avatar.classList.add("hop");
  }

  function moveSlider(btn, animate) {
    const left = btn.offsetLeft;
    const right = ui.tools.clientWidth - left - btn.offsetWidth;
    const prev = parseFloat(ui.slider.style.getPropertyValue("--l")) || 0;
    const movingRight = left > prev;
    ui.slider.classList.toggle("still", !animate);
    ui.slider.style.setProperty("--dl", movingRight ? "110ms" : "0ms");
    ui.slider.style.setProperty("--dr", movingRight ? "0ms" : "110ms");
    ui.slider.style.setProperty("--l", `${left}px`);
    ui.slider.style.setProperty("--r", `${right}px`);
  }

  function setMode(mode, animate = true) {
    if (mode === state.mode && animate) return;
    state.mode = mode;
    ui.modeEl.classList.toggle("on", mode === "element");
    ui.modeBox.classList.toggle("on", mode === "box");
    moveSlider(mode === "element" ? ui.modeEl : ui.modeBox, animate);
    ui.hover.style.display = "none";
    document.documentElement.style.cursor = mode === "box" ? "crosshair" : "";
  }

  // ---------- sessions ----------
  function renderTarget() {
    const count = state.sessions.length;
    if (state.target) {
      ui.dot.className = "dot ok";
      ui.status.textContent = state.target.project;
      ui.picker.title = `Sendet an Claude Code in ${state.target.cwd}${count > 1 ? ` · ${count} Sessions offen` : ""}`;
    } else {
      ui.dot.className = `dot ${count ? "warn" : "err"}`;
      ui.status.textContent = count ? "Session wählen" : "keine Session";
      ui.picker.title = count ? "Mehrere Claude-Sessions laufen. Wähle, wohin diese Seite sendet." : "Keine Claude-Session mit Channel-Flag gefunden";
    }
  }

  function renderMenu() {
    ui.menu.replaceChildren();
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Senden an";
    ui.menu.append(title);
    if (!state.sessions.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = "Keine Session gefunden. Starte Claude mit <code>claudep</code> im Projektordner.";
      ui.menu.append(empty);
      return;
    }
    for (const session of state.sessions) {
      const item = document.createElement("button");
      item.classList.toggle("on", session.cwd === state.target?.cwd);
      const name = document.createElement("span");
      name.textContent = session.project;
      const path = document.createElement("small");
      path.textContent = session.cwd;
      item.append(name, path);
      item.addEventListener("click", () => chooseSession(session));
      ui.menu.append(item);
    }
  }

  async function chooseSession(session) {
    state.target = session;
    renderTarget();
    closeMenu();
    try {
      await chrome.storage.local.set({ [STORE_KEY]: session.cwd });
    } catch (error) {
      toast(`Auswahl nicht gespeichert: ${error.message}`, "err");
    }
  }

  async function refreshSessions() {
    ui.dot.className = "dot";
    ui.status.textContent = "suche …";
    const [list, stored] = await Promise.all([
      chrome.runtime.sendMessage({ type: "pnp:sessions" }),
      chrome.storage.local.get(STORE_KEY),
    ]);
    state.sessions = list ?? [];
    const remembered = state.sessions.find((s) => s.cwd === stored[STORE_KEY]);
    state.target = remembered ?? (state.sessions.length === 1 ? state.sessions[0] : null);
    renderTarget();
    if (ui.menu.classList.contains("show")) renderMenu();
  }

  function openMenu() {
    renderMenu();
    ui.menu.classList.add("show");
    refreshSessions().catch((e) => toast(`Sessions nicht lesbar: ${e.message}`, "err"));
  }

  function closeMenu() {
    ui.menu.classList.remove("show");
  }

  // ---------- activate / deactivate ----------
  function activate() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    state.active = true;
    ui.bar.classList.add("show");
    setMode("element", false);
    refreshSessions().catch((e) => {
      ui.dot.className = "dot err";
      ui.status.textContent = `Fehler: ${e.message}`;
    });
  }

  function deactivate() {
    state.active = false;
    closeMenu();
    closePopover();
    ui.bar.classList.remove("show");
    ui.hover.style.display = "none";
    document.documentElement.style.cursor = "";
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "pnp:toggle") state.active ? deactivate() : activate();
  });

  // ---------- selection ----------
  function openPopover(selection) {
    state.selection = { ...selection, scrollX: window.scrollX, scrollY: window.scrollY, at: Date.now() };
    ui.hover.style.display = "none";
    let label;
    ui.marks.replaceChildren();
    ui.marks.style.transform = "";
    if (selection.mode === "element") {
      label = describe(selection.el);
    } else {
      // Show what the box caught, so the user sees what Claude will get.
      const found = elementsInBox(selection.rect);
      const box = selection.rect;
      for (const { rect } of found) {
        // Cut each mark to the box, so nothing sticks out of the frame.
        const x = Math.max(rect.x, box.x);
        const y = Math.max(rect.y, box.y);
        const width = Math.min(rect.x + rect.width, box.x + box.width) - x;
        const height = Math.min(rect.y + rect.height, box.y + box.height) - y;
        const mark = document.createElement("div");
        mark.className = "mark";
        mark.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
        ui.marks.append(mark);
      }
      label = found.length === 1 ? "Bereich · 1 Element" : `Bereich · ${found.length} Elemente`;
    }
    state.selection.label = label;
    placeBox(ui.sel, selection.rect, label);
    ui.sel.style.animation = "none";
    void ui.sel.offsetWidth;
    ui.sel.style.animation = "";
    ui.what.textContent = selection.mode === "element" ? `Element · ${label}` : label;

    const popW = 380;
    const popH = 180;
    const r = selection.rect;
    let left = Math.min(Math.max(8, r.x), window.innerWidth - popW - 8);
    let top = r.y + r.height + 10;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, r.y - popH - 10);
    if (top < 8) top = Math.min(window.innerHeight - popH - 8, 8);
    ui.pop.style.left = `${left}px`;
    ui.pop.style.top = `${top}px`;
    ui.pop.classList.add("show");
    ui.input.value = "";
    ui.send.disabled = false;
    setTimeout(() => ui.input.focus(), 0);
  }

  function closePopover() {
    stopDictation();
    state.selection = null;
    ui.pop.classList.remove("show");
    // Give the focus back to the page, otherwise the E and B keys still count as typed into the overlay.
    ui.input.blur();
    ui.sel.style.display = "none";
    ui.marks.replaceChildren();
  }

  function boxRect(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function intersects(r, box) {
    return r.right > box.x && r.left < box.x + box.width && r.bottom > box.y && r.top < box.y + box.height;
  }

  /** Elements inside the box that carry their own visible text (headings, paragraphs, buttons, …). */
  function elementsInBox(box) {
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node && found.length < LIMITS.elements; node = walker.nextNode()) {
      if (node === host || host.contains(node)) continue;
      const hasOwnText = [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      const isMedia = /^(IMG|SVG|VIDEO|CANVAS|INPUT|TEXTAREA|SELECT)$/i.test(node.tagName);
      if (!hasOwnText && !isMedia) continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || !intersects(r, box)) continue;
      const text = isMedia
        ? node.getAttribute("alt") || node.getAttribute("aria-label") || node.getAttribute("placeholder") || ""
        : cleanText(node.innerText);
      found.push({ selector: selectorFor(node), text: clip(text, LIMITS.elementText), rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    }
    return found;
  }

  function buildPayload(prompt) {
    const sel = state.selection;
    const base = {
      mode: sel.mode,
      prompt,
      url: location.href,
      title: document.title,
      dpr: window.devicePixelRatio || 1,
    };
    if (sel.mode === "element") {
      const el = sel.el;
      return {
        ...base,
        rect: rectOf(el),
        selector: selectorFor(el),
        text: clip(cleanText(el.innerText), LIMITS.text),
        html: clip(el.outerHTML, LIMITS.html),
      };
    }
    const elements = elementsInBox(sel.rect).map(({ selector, text }) => ({ selector, text }));
    const text = [...new Set(elements.map((e) => e.text).filter(Boolean))].join("\n");
    return { ...base, rect: sel.rect, text: clip(text, LIMITS.text), elements };
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function submit() {
    const prompt = ui.input.value.trim();
    if (!prompt || !state.selection) {
      ui.input.focus();
      return;
    }
    if (!state.target) {
      toast(state.sessions.length ? "Erst wählen, an welche Session diese Seite sendet" : "Keine Claude-Session mit Channel-Flag gefunden", "err");
      openMenu();
      return;
    }
    stopDictation();
    ui.send.disabled = true;

    // Return to the scroll position of the selection so the box still covers the same content.
    const sel = state.selection;
    if (window.scrollX !== sel.scrollX || window.scrollY !== sel.scrollY) window.scrollTo(sel.scrollX, sel.scrollY);
    const payload = buildPayload(prompt);

    // Hide our UI so it does not show up in the screenshot.
    host.style.visibility = "hidden";
    await nextFrame();
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "pnp:send", payload, target: state.target });
    } catch (error) {
      res = { ok: false, error: error.message };
    } finally {
      host.style.visibility = "visible";
    }

    if (res?.ok) {
      closePopover();
      hop();
      const sent = res.project ? `Claude in ${res.project} hat es` : "An Claude gesendet";
      toast(res.warning ? `${sent}. ${res.warning}` : sent, res.warning ? "warn" : "ok");
    } else {
      ui.send.disabled = false;
      toast(res?.error || "Senden fehlgeschlagen", "err");
      if (res?.stale) refreshSessions().catch((e) => toast(`Sessions nicht lesbar: ${e.message}`, "err"));
    }
  }

  // ---------- dictation (Web Speech API) ----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) ui.mic.style.display = "none";

  function startDictation() {
    const rec = new Recognition();
    rec.lang = navigator.language?.startsWith("de") ? "de-DE" : navigator.language || "de-DE";
    rec.continuous = true;
    rec.interimResults = true;
    const prefix = ui.input.value ? `${ui.input.value.trimEnd()} ` : "";
    rec.onresult = (event) => {
      let text = "";
      for (const result of event.results) text += result[0].transcript;
      ui.input.value = prefix + text;
    };
    rec.onerror = (event) => {
      if (event.error !== "aborted") toast(`Diktat-Fehler: ${event.error}`, "err");
      stopDictation();
    };
    rec.onend = () => {
      state.recognition = null;
      ui.mic.classList.remove("rec");
    };
    rec.start();
    state.recognition = rec;
    ui.mic.classList.add("rec");
  }

  function stopDictation() {
    if (state.recognition) state.recognition.stop();
    state.recognition = null;
    ui.mic.classList.remove("rec");
  }

  // ---------- UI events ----------
  ui.modeEl.addEventListener("click", () => setMode("element"));
  ui.modeBox.addEventListener("click", () => setMode("box"));
  ui.close.addEventListener("click", deactivate);
  ui.picker.addEventListener("click", () => (ui.menu.classList.contains("show") ? closeMenu() : openMenu()));
  ui.cancel.addEventListener("click", closePopover);
  // isTrusted: only real user input may send, never events a page script dispatched.
  ui.send.addEventListener("click", (event) => {
    if (event.isTrusted) submit();
  });
  ui.mic.addEventListener("click", () => (state.recognition ? stopDictation() : startDictation()));
  ui.input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    // Enter sends, Shift+Enter adds a line; isComposing keeps IME input (e.g. accents) from sending early.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.isTrusted) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      closePopover();
    }
  });

  // ---------- page events (capture phase, so the page does not react while picking) ----------
  const blocking = () => state.active && !state.selection;

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!blocking() || isOurs(event)) return;
      if (state.mode === "box") {
        if (state.drag) {
          placeBox(ui.hover, boxRect(state.drag, { x: event.clientX, y: event.clientY }), "");
        }
        return;
      }
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === host || el === document.documentElement || el === document.body) {
        ui.hover.style.display = "none";
        state.hoverEl = null;
        return;
      }
      state.hoverEl = el;
      placeBox(ui.hover, rectOf(el), describe(el));
    },
    true,
  );

  document.addEventListener(
    "mousedown",
    (event) => {
      if (!blocking() || isOurs(event) || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (state.mode === "box") state.drag = { x: event.clientX, y: event.clientY };
    },
    true,
  );

  document.addEventListener(
    "mouseup",
    (event) => {
      if (!blocking() || isOurs(event) || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (state.mode !== "box" || !state.drag) return;
      const rect = boxRect(state.drag, { x: event.clientX, y: event.clientY });
      state.drag = null;
      ui.hover.style.display = "none";
      if (rect.width < MIN_BOX || rect.height < MIN_BOX) return;
      openPopover({ mode: "box", rect });
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!state.active || isOurs(event)) return;
      // The click that ends a box drag must not reach the page (it could follow a link).
      if (state.selection && Date.now() - state.selection.at < 400) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (state.selection) return; // later clicks outside the popover are left to the page
      event.preventDefault();
      event.stopPropagation();
      if (state.mode === "element" && state.hoverEl) {
        openPopover({ mode: "element", el: state.hoverEl, rect: rectOf(state.hoverEl) });
      }
    },
    true,
  );

  window.addEventListener(
    "scroll",
    () => {
      if (state.active && !state.selection) ui.hover.style.display = "none";
      const sel = state.selection;
      if (sel?.el) placeBox(ui.sel, rectOf(sel.el), describe(sel.el));
      if (sel?.mode === "box") {
        // The box belongs to the page content, so frame and marks move with it.
        const dx = sel.scrollX - window.scrollX;
        const dy = sel.scrollY - window.scrollY;
        ui.marks.style.transform = `translate(${dx}px, ${dy}px)`;
        placeBox(ui.sel, { ...sel.rect, x: sel.rect.x + dx, y: sel.rect.y + dy }, sel.label);
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!state.active || isOurs(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (ui.menu.classList.contains("show")) closeMenu();
        else state.selection ? closePopover() : deactivate();
        return;
      }
      if (state.selection || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      if (event.key === "b" || event.key === "B") setMode("box");
      if (event.key === "e" || event.key === "E") setMode("element");
    },
    true,
  );
})();
