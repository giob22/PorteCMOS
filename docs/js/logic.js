// Operazioni sulle espressioni: variabili, valutazione, forma normale negata
// (NNF), semplificazioni elementari e formattazione in HTML.

const collator = new Intl.Collator('en', { numeric: true });

export function variables(ast) {
  const names = new Set();
  (function walk(n) {
    if (n.type === 'var') names.add(n.name);
    else if (n.type === 'not') walk(n.arg);
    else if (n.args) n.args.forEach(walk);
  })(ast);
  return [...names].sort(collator.compare);
}

export function evaluate(n, env) {
  switch (n.type) {
    case 'var': return env[n.name] ? 1 : 0;
    case 'const': return n.value;
    case 'not': return 1 - evaluate(n.arg, env);
    case 'and': return n.args.every((a) => evaluate(a, env)) ? 1 : 0;
    case 'or': return n.args.some((a) => evaluate(a, env)) ? 1 : 0;
    case 'xor': return n.args.reduce((acc, a) => acc ^ evaluate(a, env), 0);
    default: throw new Error(`Nodo sconosciuto: ${n.type}`);
  }
}

/**
 * Forma normale negata: i NOT compaiono solo sulle variabili e gli XOR sono
 * espansi in AND/OR. Con negate=true restituisce la NNF del complemento
 * (leggi di De Morgan).
 */
export function toNNF(n, negate = false) {
  switch (n.type) {
    case 'var':
      return negate ? { type: 'not', arg: n } : n;
    case 'const':
      return { type: 'const', value: negate ? 1 - n.value : n.value };
    case 'not':
      return toNNF(n.arg, !negate);
    case 'and':
    case 'or': {
      const type = (n.type === 'and') !== negate ? 'and' : 'or';
      return { type, args: n.args.map((a) => toNNF(a, negate)) };
    }
    case 'xor': {
      const [a, ...rest] = n.args;
      const b = rest.length === 1 ? rest[0] : { type: 'xor', args: rest };
      // a⊕b = a·b' + a'·b        (a⊕b)' = a·b + a'·b'
      return {
        type: 'or',
        args: [
          { type: 'and', args: [toNNF(a), toNNF(b, !negate)] },
          { type: 'and', args: [toNNF(a, true), toNNF(b, negate)] },
        ],
      };
    }
    default:
      throw new Error(`Nodo sconosciuto: ${n.type}`);
  }
}

/** Chiave canonica (commutativa) di un'espressione, usata per trovare duplicati. */
export function key(n) {
  switch (n.type) {
    case 'var': return n.name;
    case 'const': return String(n.value);
    case 'not': return `!${key(n.arg)}`;
    default: return `${n.type}(${n.args.map(key).sort().join(',')})`;
  }
}

/**
 * Semplificazioni elementari su un'espressione in NNF: appiattisce AND/OR
 * annidati, elimina costanti e termini ripetuti (A·A = A), riconosce
 * A·A' = 0 e A + A' = 1.
 */
export function simplify(n) {
  if (n.type !== 'and' && n.type !== 'or') return n;
  const absorbing = n.type === 'and' ? 0 : 1; // A·0 = 0, A + 1 = 1
  const args = [];
  const seen = new Set();
  for (const raw of n.args) {
    const a = simplify(raw);
    for (const part of a.type === n.type ? a.args : [a]) {
      if (part.type === 'const') {
        if (part.value === absorbing) return { type: 'const', value: absorbing };
        continue; // elemento neutro
      }
      const k = key(part);
      if (seen.has(k)) continue;
      seen.add(k);
      args.push(part);
    }
  }
  if (args.some((a) => a.type === 'var' && seen.has(`!${a.name}`))) {
    return { type: 'const', value: absorbing };
  }
  if (args.length === 0) return { type: 'const', value: 1 - absorbing };
  if (args.length === 1) return args[0];
  return { type: n.type, args };
}

/** Scambia AND e OR: la struttura della rete duale (pull-up). */
export function dual(n) {
  if (n.type === 'and' || n.type === 'or') {
    return { type: n.type === 'and' ? 'or' : 'and', args: n.args.map(dual) };
  }
  return n;
}

/** Nome di variabile in HTML: le cifre finali diventano pedici (A1 -> A₁). */
export function varHTML(name) {
  const m = /^([A-Za-z])([0-9]*)$/.exec(name);
  if (!m) return name;
  return m[2] ? `${m[1]}<sub>${m[2]}</sub>` : m[1];
}

/**
 * Espressione in HTML con la negazione resa come soprassegno (classe "ol").
 * Se tutte le variabili sono di una sola lettera l'AND è scritto per
 * giustapposizione (A + BCD), altrimenti con il punto (A1 + B1·C1).
 */
export function toHTML(ast) {
  const compact = variables(ast).every((v) => v.length === 1);
  const fmt = (n, parent) => {
    switch (n.type) {
      case 'var': return varHTML(n.name);
      case 'const': return String(n.value);
      case 'not': return `<span class="ol">${fmt(n.arg, 0)}</span>`;
      case 'and': {
        const s = n.args.map((a) => fmt(a, 3)).join(compact ? '' : '·');
        return parent > 3 ? `(${s})` : s;
      }
      case 'xor': {
        const s = n.args.map((a) => fmt(a, 2)).join(' ⊕ ');
        return parent > 2 ? `(${s})` : s;
      }
      case 'or': {
        const s = n.args.map((a) => fmt(a, 1)).join(' + ');
        return parent > 1 ? `(${s})` : s;
      }
      default: return '?';
    }
  };
  return fmt(ast, 0);
}
