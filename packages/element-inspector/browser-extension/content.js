(() => {
  const WS_PORTS = [9876, 9877, 9878, 9879, 9880];
  const COLORS = {
    primary: "#40CAB6",
    primaryLight: "rgba(64, 202, 182, 0.08)",
    primaryBorder: "rgba(64, 202, 182, 0.3)",
    bg: "#ffffff",
    bgElevated: "#ffffff",
    text: "#1a1a1a",
    textMuted: "#9ca3af",
    border: "#e5e7eb",
    borderFocus: "#40CAB6",
    shadow: "0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
  };

  let inspectMode = false;
  let selectedElements = [];
  let hoverOverlay = null;
  let bubble = null;
  let sessions = [];
  let activeSession = null;

  function connectAll() {
    for (const port of WS_PORTS) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.onopen = () => {
        const s = { port, ws, name: `Pi :${port}` };
        sessions.push(s);
        if (!activeSession) activeSession = s;
        updateSessionPicker();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "session") {
            const s = sessions.find((x) => x.port === port);
            if (s) s.name = msg.name || `Pi :${port}`;
            updateSessionPicker();
          }
        } catch {}
      };
      ws.onclose = () => {
        sessions = sessions.filter((s) => s.port !== port);
        if (activeSession?.port === port) activeSession = sessions[0] || null;
        updateSessionPicker();
      };
      ws.onerror = () => {};
    }
  }

  function disconnectAll() {
    sessions.forEach((s) => s.ws.close());
    sessions = [];
    activeSession = null;
  }

  function send(payload) {
    if (!activeSession || activeSession.ws.readyState !== WebSocket.OPEN) return;
    activeSession.ws.send(JSON.stringify(payload));
  }

  function createHoverOverlay() {
    if (hoverOverlay) return;
    hoverOverlay = document.createElement("div");
    hoverOverlay.id = "__pi-hover";
    Object.assign(hoverOverlay.style, {
      position: "fixed", pointerEvents: "none",
      border: `1.5px dashed ${COLORS.primary}`,
      backgroundColor: COLORS.primaryLight,
      zIndex: "2147483646",
      borderRadius: "4px",
      transition: "all 0.05s ease-out",
      display: "none",
    });
    document.body.appendChild(hoverOverlay);
  }

  function addSelectionOverlay(el) {
    const rect = el.getBoundingClientRect();
    const ov = document.createElement("div");
    ov.className = "__pi-sel";
    Object.assign(ov.style, {
      position: "fixed", pointerEvents: "none",
      border: `2px solid ${COLORS.primary}`,
      backgroundColor: COLORS.primaryLight,
      zIndex: "2147483645",
      borderRadius: "4px",
      top: rect.top + "px", left: rect.left + "px",
      width: rect.width + "px", height: rect.height + "px",
    });
    const label = document.createElement("span");
    label.textContent = getComponentName(el) || el.tagName.toLowerCase();
    Object.assign(label.style, {
      position: "absolute", top: "-20px", left: "0",
      fontSize: "10px", fontFamily: "SF Mono, Menlo, monospace",
      color: COLORS.bg, backgroundColor: COLORS.primary,
      padding: "2px 6px", borderRadius: "3px", whiteSpace: "nowrap",
    });
    ov.appendChild(label);
    document.body.appendChild(ov);
    return ov;
  }

  function showBubble() {
    if (bubble) { updateBubbleChips(); return; }

    bubble = document.createElement("div");
    bubble.id = "__pi-bubble";
    Object.assign(bubble.style, {
      position: "fixed",
      bottom: "24px", left: "50%", transform: "translateX(-50%)",
      zIndex: "2147483647",
      backgroundColor: COLORS.bgElevated,
      borderRadius: "16px",
      border: `1px solid ${COLORS.border}`,
      boxShadow: COLORS.shadow,
      width: "420px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "13px",
      color: COLORS.text,
      overflow: "hidden",
      animation: "__pi-slide-up 0.2s ease-out",
    });

    bubble.innerHTML = `
      <style>
        @keyframes __pi-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        #__pi-session-select {
          appearance: none; border: 1px solid ${COLORS.border}; border-radius: 6px;
          padding: 2px 20px 2px 8px; font-size: 11px; color: ${COLORS.text};
          background: ${COLORS.bg} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239ca3af'/%3E%3C/svg%3E") no-repeat right 6px center;
          cursor: pointer; outline: none; max-width: 140px;
        }
        #__pi-session-select:focus { border-color: ${COLORS.borderFocus}; }
      </style>
      <div style="padding:12px 16px 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <div id="__pi-chips" style="display:flex;flex-wrap:wrap;gap:6px;flex:1;"></div>
        <select id="__pi-session-select"></select>
      </div>
      <div style="padding:4px 12px 12px;">
        <div style="
          display:flex;align-items:flex-end;gap:8px;
          background:${COLORS.bg};border:1px solid ${COLORS.border};
          border-radius:12px;padding:8px 12px;
          transition:border-color 0.15s;
        " id="__pi-input-wrap">
          <textarea id="__pi-input" placeholder="Describe what you want to change..." style="
            flex:1;border:none;outline:none;resize:none;
            font-family:inherit;font-size:13px;color:${COLORS.text};
            background:transparent;min-height:20px;max-height:80px;
            line-height:1.4;
          " rows="1"></textarea>
          <button id="__pi-submit" style="
            border:none;background:${COLORS.primary};color:#fff;
            border-radius:8px;padding:6px 14px;font-size:12px;
            font-weight:600;cursor:pointer;white-space:nowrap;
          ">Send</button>
        </div>
      </div>
    `;

    document.body.appendChild(bubble);
    updateBubbleChips();
    updateSessionPicker();

    const input = bubble.querySelector("#__pi-input");
    const wrap = bubble.querySelector("#__pi-input-wrap");

    input.focus();
    input.addEventListener("focus", () => wrap.style.borderColor = COLORS.borderFocus);
    input.addEventListener("blur", () => wrap.style.borderColor = COLORS.border);
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 80) + "px";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendToPi(); }
      if (e.key === "Escape") { e.preventDefault(); toggleInspect(false); }
    });
    bubble.querySelector("#__pi-submit").addEventListener("click", sendToPi);

    const select = bubble.querySelector("#__pi-session-select");
    select.addEventListener("change", (e) => {
      const port = parseInt(e.target.value);
      activeSession = sessions.find((s) => s.port === port) || activeSession;
    });
  }

  function updateSessionPicker() {
    if (!bubble) return;
    const select = bubble.querySelector("#__pi-session-select");
    if (!select) return;

    select.innerHTML = sessions.map((s) =>
      `<option value="${s.port}" ${s.port === activeSession?.port ? "selected" : ""}>${s.name}</option>`
    ).join("");

    select.style.display = sessions.length > 1 ? "block" : "none";
    if (sessions.length <= 1 && activeSession) {
      const nameEl = bubble.querySelector("#__pi-session-name");
      if (!nameEl) {
        const span = document.createElement("span");
        span.id = "__pi-session-name";
        span.style.cssText = `color:${COLORS.textMuted};font-size:11px;white-space:nowrap;`;
        span.textContent = activeSession.name;
        select.parentNode.appendChild(span);
      }
    }
  }

  function updateBubbleChips() {
    if (!bubble) return;
    const container = bubble.querySelector("#__pi-chips");
    if (!container) return;

    container.innerHTML = selectedElements.map((item, i) => {
      const name = getComponentName(item.el) || item.el.tagName.toLowerCase();
      return `<span data-chip="${i}" style="
        display:inline-flex;align-items:center;gap:4px;
        background:${COLORS.primaryLight};border:1px solid ${COLORS.primaryBorder};
        border-radius:6px;padding:3px 8px;font-size:11px;
        font-family:SF Mono,Menlo,monospace;color:${COLORS.text};cursor:pointer;
      ">${name} <span style="opacity:0.4;">\u00d7</span></span>`;
    }).join("");

    container.querySelectorAll("[data-chip]").forEach((chip) => {
      chip.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(chip.dataset.chip);
        selectedElements[idx]?.overlay?.remove();
        selectedElements.splice(idx, 1);
        if (selectedElements.length === 0) closeBubble();
        else updateBubbleChips();
      };
    });
  }

  function closeBubble() {
    bubble?.remove();
    bubble = null;
  }

  function clearSelections() {
    selectedElements.forEach((item) => item.overlay?.remove());
    selectedElements = [];
  }

  function sendToPi() {
    if (selectedElements.length === 0) return;
    const prompt = bubble?.querySelector("#__pi-input")?.value || "";
    const elements = selectedElements.map((item) => extractElementData(item.el));
    send({ type: "inspect", elements, prompt });
    toggleInspect(false);
  }

  function getReactFiber(el) {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    return key ? el[key] : null;
  }

  function getComponentName(el) {
    let fiber = getReactFiber(el);
    if (!fiber) return null;
    let depth = 0;
    while (fiber && depth < 15) {
      if (fiber.type && typeof fiber.type === "function") {
        const name = fiber.type.displayName || fiber.type.name;
        if (name && name[0] === name[0].toUpperCase()) return name;
      }
      fiber = fiber.return;
      depth++;
    }
    return null;
  }

  function getReactComponentInfo(el) {
    let fiber = getReactFiber(el);
    if (!fiber) return {};
    let depth = 0;
    while (fiber && depth < 20) {
      if (fiber._debugSource) {
        const source = fiber._debugSource;
        const componentName = typeof fiber.type === "function"
          ? fiber.type.displayName || fiber.type.name : null;
        let filePath = source.fileName || "";
        const srcIndex = filePath.indexOf("/src/");
        if (srcIndex !== -1) filePath = filePath.slice(srcIndex + 1);
        return { component: componentName, filePath, line: source.lineNumber };
      }
      if (fiber.type && typeof fiber.type === "function") {
        const name = fiber.type.displayName || fiber.type.name;
        if (name && name[0] === name[0].toUpperCase()) return { component: name };
      }
      fiber = fiber.return;
      depth++;
    }
    return {};
  }

  function getRelevantProps(el) {
    let fiber = getReactFiber(el);
    if (!fiber) return null;
    let depth = 0;
    while (fiber && depth < 10) {
      if (fiber.memoizedProps && typeof fiber.type === "function") {
        const props = { ...fiber.memoizedProps };
        delete props.children;
        const filtered = {};
        for (const [k, v] of Object.entries(props)) {
          if (typeof v === "function") filtered[k] = "[fn]";
          else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") filtered[k] = v;
        }
        if (Object.keys(filtered).length > 0) return filtered;
      }
      fiber = fiber.return;
      depth++;
    }
    return null;
  }

  function getRelevantStyles(el) {
    const computed = window.getComputedStyle(el);
    const interesting = [
      "backgroundColor", "color", "fontSize", "fontWeight",
      "padding", "gap", "borderRadius", "display",
      "flexDirection", "alignItems", "justifyContent",
    ];
    const styles = {};
    const skip = ["0px", "normal", "none", "rgba(0, 0, 0, 0)", "auto", "stretch", "visible", "static", "row"];
    for (const prop of interesting) {
      const val = computed[prop];
      if (val && !skip.includes(val)) {
        styles[prop.replace(/([A-Z])/g, "-$1").toLowerCase()] = val;
      }
    }
    return Object.keys(styles).length > 0 ? styles : undefined;
  }

  function extractElementData(el) {
    const rect = el.getBoundingClientRect();
    const reactInfo = getReactComponentInfo(el);
    const props = getRelevantProps(el);
    const textContent = el.innerText?.trim().slice(0, 200) || undefined;
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: el.className && typeof el.className === "string"
        ? el.className.split(/\s+/).filter(Boolean) : undefined,
      text: textContent,
      ...reactInfo,
      props: props || undefined,
      computedStyles: getRelevantStyles(el),
      boundingBox: { width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }

  function onMouseMove(e) {
    if (!inspectMode) return;
    if (e.target.id?.startsWith("__pi-") || e.target.closest?.("[id^='__pi-']")) return;
    const rect = e.target.getBoundingClientRect();
    if (hoverOverlay) {
      Object.assign(hoverOverlay.style, {
        display: "block",
        top: rect.top + "px", left: rect.left + "px",
        width: rect.width + "px", height: rect.height + "px",
      });
    }
  }

  function onClick(e) {
    if (!inspectMode) return;
    if (e.target.id?.startsWith("__pi-") || e.target.closest?.("[id^='__pi-']")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = e.target;
    const existingIdx = selectedElements.findIndex((item) => item.el === el);

    if (existingIdx !== -1) {
      selectedElements[existingIdx].overlay?.remove();
      selectedElements.splice(existingIdx, 1);
      if (selectedElements.length === 0) closeBubble();
      else updateBubbleChips();
    } else {
      const ov = addSelectionOverlay(el);
      selectedElements.push({ el, overlay: ov });
      showBubble();
    }

    if (hoverOverlay) hoverOverlay.style.display = "none";
  }

  function onKeyDown(e) {
    if (e.target.closest?.("[id^='__pi-']")) {
      if (e.key === "Escape") { e.preventDefault(); toggleInspect(false); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); toggleInspect(false); }
  }

  function toggleInspect(force) {
    inspectMode = force !== undefined ? force : !inspectMode;

    if (inspectMode) {
      connectAll();
      createHoverOverlay();
      clearSelections();
      closeBubble();
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
      document.body.style.cursor = "crosshair";
    } else {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.cursor = "";
      hoverOverlay?.remove(); hoverOverlay = null;
      closeBubble();
      clearSelections();
      disconnectAll();
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "ping") { sendResponse("pong"); return; }
    if (msg.action === "toggle-inspect") toggleInspect();
  });
})();
