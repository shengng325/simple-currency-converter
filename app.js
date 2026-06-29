// Main UI logic: amount transform/parse, the searchable currency combobox,
// and the live conversion table.
(function () {
  "use strict";

  const { transformInput, parseAmount } = window.AmountLib;
  const CURRENCIES = window.CURRENCIES;
  const PRIORITY_CODES = window.PRIORITY_CODES;

  // ---- element refs ----
  const els = {
    amount: document.getElementById("amount"),
    amountStatus: document.getElementById("amount-status"),
    shortcuts: document.querySelectorAll(".chip"),
    combobox: document.getElementById("combobox"),
    trigger: document.getElementById("combobox-trigger"),
    panel: document.getElementById("combobox-panel"),
    search: document.getElementById("currency-search"),
    list: document.getElementById("combobox-list"),
    selected: document.getElementById("selected-currency"),
    parsed: document.getElementById("parsed-amount"),
    ratesBody: document.getElementById("rates-body"),
    updated: document.getElementById("updated"),
  };

  // ---- state ----
  const state = {
    rates: null, // { base, date, fetched_at, rates: {code: perUsd} }
    fromCode: "sgd", // default input currency
    activeIndex: -1, // highlighted option in the open list
    filtered: [], // currently shown options
  };

  const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));
  const display = (c) => c.label || c.code.toUpperCase();

  // ============================================================
  // Rates loading
  // ============================================================
  async function loadRates() {
    try {
      const res = await fetch("data/rates.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.rates = await res.json();
      renderUpdated();
    } catch (err) {
      els.updated.textContent =
        "⚠️ Could not load exchange rates (data/rates.json). Serve over HTTP, not file://.";
      console.error(err);
    }
    render();
  }

  function renderUpdated() {
    const r = state.rates;
    if (!r) return;
    const stamp = r.fetched_at || r.date;
    let when = r.date || "unknown";
    if (stamp) {
      const d = new Date(stamp);
      if (!isNaN(d)) {
        when = d.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    }
    els.updated.innerHTML = "Rates last updated: <strong>" + when + "</strong>";
  }

  // ============================================================
  // Number formatting
  // ============================================================
  function formatMoney(value) {
    if (!isFinite(value)) return "—";
    const abs = Math.abs(value);
    let opts;
    if (abs !== 0 && abs < 1) {
      opts = { minimumFractionDigits: 2, maximumFractionDigits: 6 };
    } else {
      opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    }
    return new Intl.NumberFormat(undefined, opts).format(value);
  }

  function formatCompact(value) {
    if (!isFinite(value) || Math.abs(value) < 1e6) return "";
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  }

  // ============================================================
  // Conversion
  // ============================================================
  function rateOf(code) {
    if (!state.rates) return null;
    if (code === state.rates.base) return 1;
    const r = state.rates.rates[code];
    return typeof r === "number" ? r : null;
  }

  // Convert `value` from `state.fromCode` into `toCode`.
  function convert(value, toCode) {
    const from = rateOf(state.fromCode);
    const to = rateOf(toCode);
    if (from == null || to == null || from === 0) return null;
    return (value / from) * to;
  }

  // ============================================================
  // Output table
  // ============================================================
  function render() {
    const parsed = parseAmount(els.amount.value);
    renderStatus(parsed);

    const value = parsed.ok ? parsed.value : null;
    renderParsed(parsed);

    const rows = PRIORITY_CODES.map((code) => {
      const meta = byCode.get(code) || { code, country: "", flag: "" };
      const converted = value == null ? null : convert(value, code);
      const isFrom = code === state.fromCode;
      return `
        <tr class="${isFrom ? "is-from" : ""}">
          <td class="cur">
            <span class="flag">${meta.flag || ""}</span>
            <span class="code">${display(meta)}</span>
            ${isFrom ? '<span class="badge">from</span>' : ""}
          </td>
          <td class="num">${amountCell(converted)}</td>
          <td class="country">${meta.country || ""}</td>
        </tr>`;
    }).join("");

    els.ratesBody.innerHTML = rows;
  }

  // Render the Amount cell. Large values (≥ 1M) show a compact form (e.g.
  // 426.35B) as the main display; clicking reveals a tooltip with the exact
  // number. Smaller values are already exact, so they're shown plainly.
  function amountCell(value) {
    if (value == null || !isFinite(value)) return '<span class="muted">—</span>';
    const full = formatMoney(value);
    const compact = formatCompact(value); // "" when below 1e6
    if (!compact) return `<span class="amount-plain">${full}</span>`;
    return (
      '<button type="button" class="amount" aria-expanded="false" title="Click for exact amount">' +
      `<span class="amount-main">${compact}</span>` +
      `<span class="tip" role="tooltip">${full}</span>` +
      "</button>"
    );
  }

  function renderStatus(parsed) {
    const el = els.amountStatus;
    if (parsed.empty) {
      el.textContent = "Enter an amount to convert.";
      el.className = "status";
    } else if (parsed.ok) {
      el.textContent = "";
      el.className = "status ok";
    } else {
      el.textContent = "⚠️ " + parsed.error;
      el.className = "status error";
    }
  }

  function renderParsed(parsed) {
    if (!parsed.ok) {
      els.parsed.textContent = "";
      return;
    }
    const meta = byCode.get(state.fromCode);
    const compact = formatCompact(parsed.value);
    els.parsed.innerHTML =
      `<span class="muted">${formatMoney(parsed.value)}</span> ` +
      `${display(meta || { code: state.fromCode })}` +
      (compact ? ` <span class="compact">(${compact})</span>` : "");
  }

  // ============================================================
  // Amount input
  // ============================================================
  // The last caret/selection the user actually placed in the amount field (by
  // typing, clicking, arrow keys, or selecting). Starts null and is updated only
  // by real interactions — never by the browser silently restoring focus on
  // reload (which leaves the caret at 0). So a chip inserts at the real cursor,
  // and falls back to the end when no cursor has been placed yet.
  let amountSel = null;

  function rememberSel() {
    const el = els.amount;
    amountSel = { start: el.selectionStart, end: el.selectionEnd };
  }

  function onAmountInput() {
    // Live transform (w->万 etc). Every mapping is 1:1 char so caret holds.
    const el = els.amount;
    const caret = el.selectionStart;
    const transformed = transformInput(el.value);
    if (transformed !== el.value) {
      el.value = transformed;
      el.setSelectionRange(caret, caret);
    }
    rememberSel();
    render();
  }

  // Insert a unit at the user's cursor (mid-string works), or append to the end
  // when no cursor has been placed yet.
  function insertUnit(unit) {
    const el = els.amount;
    const len = el.value.length;
    let start = amountSel ? amountSel.start : len;
    let end = amountSel ? amountSel.end : len;
    start = Math.min(Math.max(start, 0), len);
    end = Math.min(Math.max(end, start), len);
    el.value = el.value.slice(0, start) + unit + el.value.slice(end);
    const pos = start + unit.length;
    el.focus();
    el.setSelectionRange(pos, pos);
    onAmountInput();
  }

  // ============================================================
  // Currency combobox
  // ============================================================
  function availableCurrencies() {
    // Only currencies we actually have a rate for.
    return CURRENCIES.filter((c) => rateOf(c.code) != null);
  }

  function matches(c, q) {
    if (!q) return true;
    const hay = [
      c.code,
      c.label || "",
      c.name,
      c.country,
      ...(c.aliases || []),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function buildList() {
    const q = els.search.value.trim().toLowerCase();
    const all = availableCurrencies();
    const priority = [];
    const rest = [];
    for (const c of all) {
      if (!matches(c, q)) continue;
      (PRIORITY_CODES.includes(c.code) ? priority : rest).push(c);
    }
    // Keep priority in the README's order; sort the rest by country name.
    priority.sort(
      (a, b) => PRIORITY_CODES.indexOf(a.code) - PRIORITY_CODES.indexOf(b.code),
    );
    rest.sort((a, b) => a.country.localeCompare(b.country));

    state.filtered = [...priority, ...rest];
    state.activeIndex = state.filtered.length ? 0 : -1;

    let html = "";
    if (priority.length) {
      html += `<li class="group" role="presentation">Top currencies</li>`;
      html += priority.map((c, i) => optionHtml(c, i)).join("");
    }
    if (rest.length) {
      html += `<li class="group" role="presentation">All currencies</li>`;
      html += rest
        .map((c, i) => optionHtml(c, priority.length + i))
        .join("");
    }
    if (!state.filtered.length) {
      html = `<li class="empty" role="presentation">No match for “${els.search.value}”.</li>`;
    }
    els.list.innerHTML = html;
    highlight();
  }

  function optionHtml(c, index) {
    const selected = c.code === state.fromCode;
    return `
      <li class="option ${selected ? "selected" : ""}" role="option"
          aria-selected="${selected}" data-code="${c.code}" data-index="${index}">
        <span class="flag">${c.flag || ""}</span>
        <span class="opt-main">
          <span class="opt-code">${display(c)}</span>
          <span class="opt-name">${c.name}</span>
        </span>
        <span class="opt-country">${c.country}</span>
      </li>`;
  }

  function highlight() {
    const opts = els.list.querySelectorAll(".option");
    opts.forEach((o) => {
      const active = Number(o.dataset.index) === state.activeIndex;
      o.classList.toggle("active", active);
      if (active) o.scrollIntoView({ block: "nearest" });
    });
  }

  function openPanel() {
    els.panel.hidden = false;
    els.trigger.setAttribute("aria-expanded", "true");
    buildList();
    els.search.value = "";
    buildList();
    els.search.focus();
  }

  function closePanel() {
    els.panel.hidden = true;
    els.trigger.setAttribute("aria-expanded", "false");
  }

  // Update the trigger label + table for the given currency (no panel changes).
  function applyCurrency(code) {
    state.fromCode = code;
    const meta = byCode.get(code) || { code, flag: "", country: "" };
    els.selected.innerHTML = `
      <span class="flag">${meta.flag || ""}</span>
      <span class="sel-code">${display(meta)}</span>
      <span class="sel-country">${meta.country || ""}</span>`;
    render();
  }

  function selectCode(code) {
    if (!byCode.has(code) && rateOf(code) == null) return;
    applyCurrency(code);
    closePanel();
  }

  // ============================================================
  // Mobile scrub gesture: hold or drag vertically on the trigger to flick
  // through the high-precedence currencies (like TradingView's value scrubber).
  // A plain tap still opens the searchable dropdown.
  // ============================================================
  const scrub = {
    active: false,
    startY: 0,
    baseIndex: 0,
    curIndex: 0,
    moved: false,
    longPress: null,
    suppressClick: false,
    el: null,
    strip: null,
  };
  const SCRUB_STEP_PX = 26; // vertical distance per currency step
  const SCRUB_ACTIVATE_PX = 12; // drag distance that enters scrub mode
  const SCRUB_LONGPRESS_MS = 350; // hold time that enters scrub mode
  const SCRUB_ROWS = 3; // visible rows: previous / current / next
  const SCRUB_ROW_H = 40; // row height in px (must match .scrub-item in CSS)

  function priorityIndexOf(code) {
    const i = PRIORITY_CODES.indexOf(code);
    return i >= 0 ? i : 0;
  }

  function ensureScrubOverlay() {
    if (scrub.el) return scrub.el;
    const el = document.createElement("div");
    el.className = "scrub";
    const items = PRIORITY_CODES.map((code) => {
      const meta = byCode.get(code) || { code, flag: "", country: "" };
      return `<div class="scrub-item" data-code="${code}">
          <span class="flag">${meta.flag || ""}</span>
          <span class="scrub-code">${display(meta)}</span>
          <span class="scrub-country">${meta.country || ""}</span>
        </div>`;
    }).join("");
    el.innerHTML =
      '<div class="scrub-window"><div class="scrub-strip">' + items + "</div></div>";
    els.combobox.appendChild(el);
    scrub.el = el;
    scrub.strip = el.querySelector(".scrub-strip");
    return el;
  }

  // Wheel/scrubber: center the active currency, with the previous and next
  // faded above and below. The strip slides as the index changes — it is not a
  // dropdown list.
  function paintScrub(idx) {
    ensureScrubOverlay();
    const centerRow = Math.floor(SCRUB_ROWS / 2);
    scrub.strip.style.transform = `translateY(${(centerRow - idx) * SCRUB_ROW_H}px)`;
    scrub.strip.querySelectorAll(".scrub-item").forEach((it, i) =>
      it.classList.toggle("active", i === idx),
    );
  }

  function activateScrub() {
    if (scrub.active) return;
    scrub.active = true;
    scrub.baseIndex = priorityIndexOf(state.fromCode);
    scrub.curIndex = scrub.baseIndex;
    closePanel();
    ensureScrubOverlay().classList.add("visible");
    paintScrub(scrub.curIndex);
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function endScrub() {
    clearTimeout(scrub.longPress);
    if (!scrub.active) return;
    scrub.active = false;
    scrub.suppressClick = true; // swallow the click that follows touchend
    if (scrub.el) scrub.el.classList.remove("visible");
    setTimeout(() => (scrub.suppressClick = false), 500);
  }

  function onTriggerTouchStart(e) {
    if (e.touches.length !== 1) return;
    scrub.startY = e.touches[0].clientY;
    scrub.moved = false;
    scrub.active = false;
    clearTimeout(scrub.longPress);
    scrub.longPress = setTimeout(() => {
      if (!scrub.moved) activateScrub();
    }, SCRUB_LONGPRESS_MS);
  }

  function onTriggerTouchMove(e) {
    const y = e.touches[0].clientY;
    const dy = y - scrub.startY;
    if (!scrub.active) {
      if (Math.abs(dy) > SCRUB_ACTIVATE_PX) {
        scrub.moved = true;
        clearTimeout(scrub.longPress);
        activateScrub();
      } else {
        return;
      }
    }
    e.preventDefault(); // we own the gesture now — stop page scroll
    const delta = Math.round((scrub.startY - y) / SCRUB_STEP_PX); // up = forward
    const idx = Math.min(
      Math.max(scrub.baseIndex + delta, 0),
      PRIORITY_CODES.length - 1,
    );
    if (idx !== scrub.curIndex) {
      scrub.curIndex = idx;
      applyCurrency(PRIORITY_CODES[idx]);
      paintScrub(idx);
      if (navigator.vibrate) navigator.vibrate(5);
    }
  }

  function onTriggerTouchEnd(e) {
    if (scrub.active) e.preventDefault();
    endScrub();
  }

  // ============================================================
  // Events
  // ============================================================
  function wire() {
    els.amount.addEventListener("input", onAmountInput);
    // Remember only carets the user actually places (not browser focus-restore),
    // so chips insert at the real cursor and don't jump to the front on reload.
    ["keyup", "click", "select"].forEach((evt) =>
      els.amount.addEventListener(evt, rememberSel),
    );

    els.shortcuts.forEach((btn) => {
      // keep focus/caret in the input when a chip is clicked
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => insertUnit(btn.dataset.unit));
    });

    els.trigger.addEventListener("click", () => {
      if (scrub.suppressClick) {
        scrub.suppressClick = false;
        return; // this click is the tail of a scrub gesture, not a tap
      }
      els.panel.hidden ? openPanel() : closePanel();
    });

    // Mobile scrub gesture (touch only; desktop is unaffected).
    els.trigger.addEventListener("touchstart", onTriggerTouchStart, { passive: true });
    els.trigger.addEventListener("touchmove", onTriggerTouchMove, { passive: false });
    els.trigger.addEventListener("touchend", onTriggerTouchEnd);
    els.trigger.addEventListener("touchcancel", endScrub);

    els.search.addEventListener("input", buildList);

    els.search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.activeIndex = Math.min(state.activeIndex + 1, state.filtered.length - 1);
        highlight();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        state.activeIndex = Math.max(state.activeIndex - 1, 0);
        highlight();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const c = state.filtered[state.activeIndex];
        if (c) selectCode(c.code);
      } else if (e.key === "Escape") {
        closePanel();
        els.trigger.focus();
      }
    });

    els.list.addEventListener("click", (e) => {
      const li = e.target.closest(".option");
      if (li) selectCode(li.dataset.code);
    });

    // Amount tooltips: click an abbreviated amount to reveal the exact number.
    els.ratesBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".amount");
      closeTips(btn); // close any other open tooltip
      if (btn) {
        const open = !btn.classList.contains("open");
        btn.classList.toggle("open", open);
        btn.setAttribute("aria-expanded", String(open));
        e.stopPropagation(); // keep the outside-click handler from closing it
      }
    });

    // Close popovers when clicking outside.
    document.addEventListener("click", (e) => {
      if (!els.combobox.contains(e.target)) closePanel();
      if (!e.target.closest(".amount")) closeTips(null);
    });
  }

  function closeTips(except) {
    els.ratesBody.querySelectorAll(".amount.open").forEach((b) => {
      if (b === except) return;
      b.classList.remove("open");
      b.setAttribute("aria-expanded", "false");
    });
  }

  // ============================================================
  // Init
  // ============================================================
  wire();
  loadRates();
})();
