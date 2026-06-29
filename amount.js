// Amount input handling: Chinese myriad units (万 / 亿 / 兆), English short forms
// (k / m / b / t), typing shortcuts, and simple arithmetic.
//
// Magnitude system:
//   k = 10^3   万 = 10^4   m = 10^6   亿 = 10^8   b = 10^9   兆/t = 10^12
//
// Stacked units multiply and must read small -> large, so 万亿 (10^12) is valid
// but 亿万 is not.
//
// The amount field accepts arithmetic expressions: + - * / , brackets ( ), and
// "x" as an alias for "*". Numbers may carry unit suffixes, e.g. (10万 + 5亿) * 2.
// Evaluation is done with a small recursive-descent parser — never eval().
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

  // Keyboard shortcuts -> display character. English unit forms stay themselves;
  // "x" is a convenience alias for the "*" multiply operator.
  const KEY_MAP = {
    w: "万",
    y: "亿",
    z: "兆",
    k: "k",
    m: "m",
    b: "b",
    t: "t",
    x: "*",
  };

  const UNIT_CHARS = Object.keys(UNIT_MULT); // ["k","万","m","亿","b","兆","t"]
  const OPERATORS = "+-*/()";

  // Turn raw typed text into normalized display text:
  // w->万, y->亿, z->兆, x->* (case-insensitive); k/m/b/t kept. Everything else
  // is kept so the parser can flag it. Every mapping is 1 char -> 1 char, so the
  // caret position is preserved by the caller.
  function transformInput(raw) {
    let out = "";
    for (const ch of raw) {
      const mapped = KEY_MAP[ch.toLowerCase()];
      out += mapped !== undefined ? mapped : ch;
    }
    return out;
  }

  // --- tokenizer -------------------------------------------------------------
  // Produces a flat list of { type:"num", value } and { type:"op", value } tokens.
  // Throws on malformed numbers, bad unit order, or unexpected characters.
  function tokenize(s) {
    const tokens = [];
    const isDigit = (c) => c >= "0" && c <= "9";
    let i = 0;

    while (i < s.length) {
      const c = s[i];

      if (c === " " || c === "\t") {
        i++;
        continue;
      }

      if (isDigit(c) || c === ".") {
        // numeric part (digits, commas, dot)
        let j = i;
        while (j < s.length && (isDigit(s[j]) || s[j] === "," || s[j] === ".")) j++;
        const raw = s.slice(i, j);
        const numStr = raw.replace(/,/g, "");
        if (!/^(\d+(\.\d+)?|\.\d+)$/.test(numStr)) {
          throw new Error(`Invalid number "${raw}".`);
        }
        const base = parseFloat(numStr);

        // trailing unit suffix, validated for ascending magnitude
        let k = j;
        let mult = 1;
        let prevExp = -Infinity;
        let units = "";
        while (k < s.length && UNIT_MULT[s[k]] !== undefined) {
          const ch = s[k];
          const exp = UNIT_EXP[ch];
          if (exp <= prevExp) {
            throw new Error(
              `Invalid unit order "${units + ch}" — units must read small → large (e.g. 万亿, not 亿万).`,
            );
          }
          prevExp = exp;
          mult *= UNIT_MULT[ch];
          units += ch;
          k++;
        }

        tokens.push({ type: "num", value: base * mult });
        i = k;
        continue;
      }

      if (OPERATORS.includes(c)) {
        tokens.push({ type: "op", value: c });
        i++;
        continue;
      }

      throw new Error(`Unexpected character "${c}".`);
    }

    return tokens;
  }

  // --- recursive-descent evaluator ------------------------------------------
  //   expr   := term (('+' | '-') term)*
  //   term   := factor (('*' | '/') factor)*
  //   factor := ('+' | '-') factor | '(' expr ')' | number
  function evaluate(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (v) => {
      const t = peek();
      return t && t.type === "op" && t.value === v;
    };

    function parseExpr() {
      let left = parseTerm();
      while (isOp("+") || isOp("-")) {
        const op = tokens[pos++].value;
        const right = parseTerm();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }

    function parseTerm() {
      let left = parseFactor();
      while (isOp("*") || isOp("/")) {
        const op = tokens[pos++].value;
        const right = parseFactor();
        if (op === "*") {
          left *= right;
        } else {
          if (right === 0) throw new Error("Division by zero.");
          left /= right;
        }
      }
      return left;
    }

    function parseFactor() {
      const t = peek();
      if (!t) throw new Error("Incomplete expression.");
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        pos++;
        const v = parseFactor();
        return t.value === "-" ? -v : v;
      }
      if (isOp("(")) {
        pos++;
        const v = parseExpr();
        if (!isOp(")")) throw new Error("Missing closing bracket “)”.");
        pos++;
        return v;
      }
      if (t.type === "num") {
        pos++;
        return t.value;
      }
      throw new Error(`Unexpected "${t.value}".`);
    }

    const value = parseExpr();
    if (pos < tokens.length) {
      throw new Error(
        `Unexpected "${tokens[pos].value}" — check your operators and brackets.`,
      );
    }
    return value;
  }

  // Parse + evaluate the amount expression.
  // Returns one of:
  //   { ok:true,  value, normalized }
  //   { ok:false, normalized, empty:true }   (nothing entered)
  //   { ok:false, normalized, error:"..." }  (invalid)
  function parseAmount(text) {
    const normalized = transformInput(String(text)).trim();
    if (normalized === "") {
      return { ok: false, empty: true, normalized };
    }
    try {
      const tokens = tokenize(normalized);
      if (tokens.length === 0) return { ok: false, empty: true, normalized };
      const value = evaluate(tokens);
      if (!isFinite(value)) {
        return { ok: false, normalized, error: "Result is not a finite number." };
      }
      return { ok: true, value, normalized };
    } catch (err) {
      return { ok: false, normalized, error: err.message };
    }
  }

  const api = { transformInput, parseAmount, UNIT_MULT, UNIT_EXP, KEY_MAP, UNIT_CHARS };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.AmountLib = api;
})(typeof window !== "undefined" ? window : globalThis);
