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
    fromCode: "cny", // default: amounts in 万/亿 are usually RMB
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
      const compact = converted == null ? "" : formatCompact(converted);
      return `
        <tr class="${isFrom ? "is-from" : ""}">
          <td class="cur">
            <span class="flag">${meta.flag || ""}</span>
            <span class="code">${display(meta)}</span>
            ${isFrom ? '<span class="badge">from</span>' : ""}
          </td>
          <td class="num">
            ${converted == null ? '<span class="muted">—</span>' : formatMoney(converted)}
            ${compact ? `<span class="compact">≈ ${compact}</span>` : ""}
          </td>
          <td class="country">${meta.country || ""}</td>
        </tr>`;
    }).join("");

    els.ratesBody.innerHTML = rows;
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
  function onAmountInput() {
    // Live transform (w->万 etc). Every mapping is 1:1 char so caret holds.
    const el = els.amount;
    const caret = el.selectionStart;
    const transformed = transformInput(el.value);
    if (transformed !== el.value) {
      el.value = transformed;
      el.setSelectionRange(caret, caret);
    }
    render();
  }

  function insertUnit(unit) {
    const el = els.amount;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
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

  function selectCode(code) {
    if (!byCode.has(code) && rateOf(code) == null) return;
    state.fromCode = code;
    const meta = byCode.get(code);
    els.selected.innerHTML = `
      <span class="flag">${meta.flag || ""}</span>
      <span class="sel-code">${display(meta)}</span>
      <span class="sel-country">${meta.country || ""}</span>`;
    closePanel();
    render();
  }

  // ============================================================
  // Events
  // ============================================================
  function wire() {
    els.amount.addEventListener("input", onAmountInput);

    els.shortcuts.forEach((btn) =>
      btn.addEventListener("click", () => insertUnit(btn.dataset.unit)),
    );

    els.trigger.addEventListener("click", () => {
      els.panel.hidden ? openPanel() : closePanel();
    });

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

    // Close when clicking outside.
    document.addEventListener("click", (e) => {
      if (!els.combobox.contains(e.target)) closePanel();
    });
  }

  // ============================================================
  // Init
  // ============================================================
  wire();
  loadRates();
})();
