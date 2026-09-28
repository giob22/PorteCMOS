// Parser di espressioni booleane.
//
// Nodi dell'AST prodotto:
//   { type: 'var',   name }
//   { type: 'const', value: 0 | 1 }
//   { type: 'not',   arg }
//   { type: 'and',   args: [...] }
//   { type: 'or',    args: [...] }
//   { type: 'xor',   args: [...] }
//
// Sintassi accettata (maiuscole/minuscole indifferenti per le parole chiave):
//   NOT : not(X)  not X  !X  ~X  ¬X  X'
//   AND : AB  A*B  A·B  A.B  A&B  A and B  and(A,B,...)
//   OR  : A+B  A|B  A or B  or(A,B,...)
//   XOR : A^B  A⊕B  A xor B  xor(A,B,...)
//   nand(...)  nor(...)  xnor(...)
//   Costanti 0 e 1, uscita opzionale "Y = ..."
//   Variabili: una lettera seguita da eventuali cifre (A, B, x1, S0).
//   Lettere adiacenti sono AND impliciti: BCD = B·C·D.

const KEYWORDS = new Set(['not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor']);

// Parole chiave utilizzabili in forma di funzione: nome(A, B, ...)
const FUNCTIONS = {
  and: { type: 'and', negated: false },
  or: { type: 'or', negated: false },
  xor: { type: 'xor', negated: false },
  nand: { type: 'and', negated: true },
  nor: { type: 'or', negated: true },
  xnor: { type: 'xor', negated: true },
};

const SYMBOLS = {
  '(': 'lp', ')': 'rp', '[': 'lp', ']': 'rp', ',': 'comma', ';': 'comma',
  '+': 'or', '|': 'or', '∨': 'or',
  '*': 'and', '·': 'and', '⋅': 'and', '.': 'and', '&': 'and', '∧': 'and', '×': 'and', '•': 'and',
  '^': 'xor', '⊕': 'xor',
  '!': 'notp', '~': 'notp', '¬': 'notp',
  "'": 'apos', '’': 'apos', '′': 'apos', '`': 'apos', '´': 'apos',
};

export class ParseError extends Error {
  constructor(message, pos, length = 1) {
    super(message);
    this.name = 'ParseError';
    this.pos = pos;
    this.length = length;
  }
}

function tokenize(src, offset) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }

    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) {
        tokens.push({ t: 'kw', v: lower, pos: offset + i, len: j - i });
      } else {
        // "BCD" -> B, C, D ; "A1B2" -> A1, B2
        const re = /[A-Za-z][0-9]*/g;
        let m;
        while ((m = re.exec(word))) {
          tokens.push({ t: 'var', v: m[0], pos: offset + i + m.index, len: m[0].length });
        }
      }
      i = j;
      continue;
    }

    if (ch === '0' || ch === '1') {
      tokens.push({ t: 'const', v: Number(ch), pos: offset + i, len: 1 });
      i++;
      continue;
    }

    const kind = SYMBOLS[ch];
    if (!kind) {
      throw new ParseError(`Carattere non riconosciuto: "${ch}"`, offset + i);
    }
    // "||" e "&&" valgono come un solo operatore
    const len = (ch === '|' || ch === '&') && src[i + 1] === ch ? 2 : 1;
    tokens.push({ t: kind, v: src.slice(i, i + len), pos: offset + i, len });
    i += len;
  }
  return tokens;
}

const isKw = (tk, ...names) => tk && tk.t === 'kw' && names.includes(tk.v);

const describe = (tk) => `"${tk.v}"`;

/**
 * Analizza un'espressione come "Y = not(A + BCD)".
 * @returns {{ output: string, ast: object }}
 */
export function parse(input) {
  let output = 'Y';
  let offset = 0;
  const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=/.exec(input);
  if (m) {
    output = m[1];
    offset = m[0].length;
  }
  const body = input.slice(offset);
  if (!body.trim()) {
    throw new ParseError('Scrivi un’espressione, ad esempio Y = not(A + BCD)', offset);
  }

  const tokens = tokenize(body, offset);
  const end = input.length;
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];

  function missingOperand(tk) {
    if (!tk) return new ParseError('Espressione incompleta: manca un operando alla fine', end);
    if (tk.t === 'rp') return new ParseError('Manca un operando prima di ")"', tk.pos, tk.len);
    return new ParseError(`Manca un operando prima di ${describe(tk)}`, tk.pos, tk.len);
  }

  function expectClose(open) {
    const tk = next();
    if (!tk) throw new ParseError('Parentesi non chiusa', open.pos, open.len);
    if (tk.t !== 'rp') throw new ParseError(`Atteso ")" ma trovato ${describe(tk)}`, tk.pos, tk.len);
  }

  function parseOr() {
    const args = [parseXor()];
    while (peek() && (peek().t === 'or' || isKw(peek(), 'or'))) {
      next();
      args.push(parseXor());
    }
    return args.length === 1 ? args[0] : { type: 'or', args };
  }

  function parseXor() {
    const args = [parseAnd()];
    while (peek() && (peek().t === 'xor' || isKw(peek(), 'xor'))) {
      next();
      args.push(parseAnd());
    }
    return args.length === 1 ? args[0] : { type: 'xor', args };
  }

  function startsOperand(tk) {
    return tk.t === 'var' || tk.t === 'const' || tk.t === 'lp' || tk.t === 'notp' ||
      isKw(tk, 'not', 'nand', 'nor', 'xnor');
  }

  function parseAnd() {
    const args = [parseUnary()];
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === 'and' || isKw(tk, 'and')) {
        next();
        args.push(parseUnary());
      } else if (startsOperand(tk)) {
        args.push(parseUnary()); // AND implicito (giustapposizione)
      } else {
        break;
      }
    }
    return args.length === 1 ? args[0] : { type: 'and', args };
  }

  function parseUnary() {
    const tk = peek();
    if (tk && (tk.t === 'notp' || isKw(tk, 'not'))) {
      next();
      return { type: 'not', arg: parseUnary() };
    }
    let node = parsePrimary();
    while (peek() && peek().t === 'apos') {
      next();
      node = { type: 'not', arg: node };
    }
    return node;
  }

  function parsePrimary() {
    const tk = peek();
    if (!tk) throw missingOperand(tk);
    switch (tk.t) {
      case 'var':
        next();
        return { type: 'var', name: tk.v };
      case 'const':
        next();
        return { type: 'const', value: tk.v };
      case 'lp': {
        next();
        if (peek() && peek().t === 'rp') throw new ParseError('Parentesi vuote', tk.pos, 2);
        const e = parseOr();
        expectClose(tk);
        return e;
      }
      case 'kw': {
        const fn = FUNCTIONS[tk.v];
        if (!fn) throw missingOperand(tk);
        next();
        const open = peek();
        if (!open || open.t !== 'lp') {
          throw new ParseError(`"${tk.v}" come funzione va scritto ${tk.v}(A, B, ...)`, tk.pos, tk.len);
        }
        next();
        const args = [parseOr()];
        while (peek() && peek().t === 'comma') {
          next();
          args.push(parseOr());
        }
        expectClose(open);
        const inner = args.length === 1 ? args[0] : { type: fn.type, args };
        return fn.negated ? { type: 'not', arg: inner } : inner;
      }
      default:
        throw missingOperand(tk);
    }
  }

  const ast = parseOr();
  if (p < tokens.length) {
    const tk = tokens[p];
    if (tk.t === 'rp') throw new ParseError('Parentesi ")" in più', tk.pos, tk.len);
    throw new ParseError(`Simbolo inatteso ${describe(tk)}`, tk.pos, tk.len);
  }
  return { output, ast };
}
