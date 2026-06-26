// Amount input handling: Chinese myriad units (万 / 亿 / 兆), the "k" thousands
// marker, typing shortcuts, and validation.
//
// Magnitude system (each unit is 10^4 larger than the previous):
//   万 = 10^4   亿 = 10^8   兆 = 10^12   (k = 10^3 thousands)
//
// Stacked units multiply and must read small -> large, so 万亿 (10^12) is valid
// but 亿万 is not.
(function (global) {
  // Multiplier contributed by each unit character.
  // English short forms (k/m/b/t) stay as-is; Chinese units are 万/亿/兆.
  const UNIT_MULT = {
    k: 1e3, // thousand
    "万": 1e4,
    m: 1e6, // million
    "亿": 1e8,
    b: 1e9, // billion
    "兆": 1e12,
    t: 1e12, // trillion
  };

  // Magnitude exponent, used to enforce ascending (small -> large) order.
  const UNIT_EXP = {
    k: 3,
    "万": 4,
    m: 6,
    "亿": 8,
    b: 9,
    "兆": 12,
    t: 12,
  };

  // Keyboard shortcuts -> unit character. English forms stay themselves.
  const KEY_MAP = { w: "万", y: "亿", z: "兆", k: "k", m: "m", b: "b", t: "t" };

  const UNIT_CHARS = Object.keys(UNIT_MULT); // ["k","万","m","亿","b","兆","t"]

  // Character class for the unit suffix, derived from UNIT_CHARS.
  const AMOUNT_RE = new RegExp(
    `^([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*([${UNIT_CHARS.join("")}]*)$`,
  );

  // Turn raw typed text into normalized display text:
  // w->万, y->亿, z->兆, k->k (case-insensitive). Everything else is kept so the
  // parser can flag it. Every mapping is 1 char -> 1 char, so caret position is
  // preserved by the caller.
  function transformInput(raw) {
    let out = "";
    for (const ch of raw) {
      const mapped = KEY_MAP[ch.toLowerCase()];
      out += mapped !== undefined ? mapped : ch;
    }
    return out;
  }

  // Parse normalized (or raw) text into a numeric value.
  // Returns one of:
  //   { ok:true,  value, base, units, normalized }
  //   { ok:false, normalized, empty:true }                      (nothing entered)
  //   { ok:false, normalized, error:"..." }                     (invalid)
  function parseAmount(text) {
    const normalized = transformInput(String(text)).trim();
    if (normalized === "") {
      return { ok: false, empty: true, normalized };
    }

    // <number><units>, number may use thousands commas and a decimal part.
    const m = normalized.match(AMOUNT_RE);
    if (!m) {
      return {
        ok: false,
        normalized,
        error: "Enter a number optionally followed by 万 / 亿 / 兆 / k / m / b / t.",
      };
    }

    const base = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(base)) {
      return { ok: false, normalized, error: "Invalid number." };
    }

    const units = m[2];
    let multiplier = 1;
    let prevExp = -Infinity;
    for (const ch of units) {
      const exp = UNIT_EXP[ch];
      if (exp <= prevExp) {
        return {
          ok: false,
          normalized,
          error: `Invalid unit order "${units}" — units must read small → large (e.g. 万亿, not 亿万).`,
        };
      }
      prevExp = exp;
      multiplier *= UNIT_MULT[ch];
    }

    return { ok: true, value: base * multiplier, base, units, normalized };
  }

  const api = { transformInput, parseAmount, UNIT_MULT, UNIT_EXP, KEY_MAP, UNIT_CHARS };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AmountLib = api;
})(typeof window !== "undefined" ? window : globalThis);
