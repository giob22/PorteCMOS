// Test di parser, sintesi e disegno. Eseguibili con Node (tests/run.mjs) o
// nel browser (tests/index.html).

import { parse, ParseError } from '../docs/js/parser.js';
import { evaluate, variables, toHTML, varHTML } from '../docs/js/logic.js';
import {
  synthesize, truthTable, sizeNetwork, inputVector, applyOrder, normalizeOrder, locate, networkExpr,
  logicalEffort,
} from '../docs/js/cmos.js';
import { renderCircuit } from '../docs/js/render.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(cond, msg = 'asserzione fallita') {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} atteso ${e}, ottenuto ${a}`.trim());
}

const synth = (src, opts) => {
  const { ast, output } = parse(src);
  return synthesize(ast, output, opts);
};

// Rete come stringa compatta: S = serie, P = parallelo, A' = ingresso negato
const shape = (n) => (n.type === 'T'
  ? `${n.input}${n.neg ? "'" : ''}`
  : `${n.type}(${n.children.map(shape).join(',')})`);

function table(src) {
  const { ast } = parse(src);
  const vars = variables(ast);
  return { vars, values: Array.from({ length: 1 << vars.length }, (_, i) => evaluate(ast, inputVector(vars, i))) };
}

function sameFunction(a, b) {
  eq(table(a), table(b), `"${a}" e "${b}" dovrebbero essere equivalenti:`);
}

function expectParseError(src) {
  try {
    parse(src);
  } catch (e) {
    assert(e instanceof ParseError, `"${src}": errore del tipo sbagliato (${e.message})`);
    return;
  }
  throw new Error(`"${src}" doveva dare errore`);
}

function checkCircuit(result, label) {
  const rows = truthTable(result);
  for (const row of rows) {
    assert(row.up !== row.down, `${label}: PUN e PDN non complementari per ${JSON.stringify(row.env)}`);
    assert(row.ok, `${label}: uscita errata per ${JSON.stringify(row.env)}`);
  }
}

// --------------------------------------------------------------------- parser

test('parser: esempio della consegna', () => {
  const { output, ast } = parse('Y=not(A + BCD)');
  eq(output, 'Y');
  const v = (name) => ({ type: 'var', name });
  eq(ast, { type: 'not', arg: { type: 'or', args: [v('A'), { type: 'and', args: [v('B'), v('C'), v('D')] }] } });
});

test('parser: notazioni equivalenti per NOT/AND/OR', () => {
  for (const s of ['!(A | B&C&D)', "(A + B·C·D)'", '~(A or B and C and D)', 'nor(A, BCD)', 'NOT(A+B*C*D)', '¬(A ∨ B∧C∧D)']) {
    sameFunction('not(A + BCD)', s);
  }
});

test('parser: XOR in tutte le forme', () => {
  for (const s of ['A^B', 'A xor B', 'xor(A,B)', 'A ⊕ B', "A'B + AB'"]) sameFunction("AB' + A'B", s);
  sameFunction('xnor(A,B)', "AB + A'B'");
  sameFunction('A ^ B ^ C', 'xor(A, B, C)');
});

test('parser: precedenze', () => {
  sameFunction('A + BC', 'A + (B·C)');
  sameFunction('A + B ^ C', 'A + (B ^ C)');
  sameFunction('not A B', "A'B");
  sameFunction("AB'", 'A·not(B)');
  sameFunction("(AB)'", 'nand(A,B)');
  sameFunction("A''", 'A');
  sameFunction('nand(A,B,C)', 'not(ABC)');
});

test('parser: nomi di uscita e variabili', () => {
  eq(parse('Out = A + B').output, 'Out');
  eq(parse('A + B').output, 'Y');
  eq(variables(parse('A1B2 + A1\'').ast), ['A1', 'B2']);
  eq(variables(parse('x2 + x10 + x1').ast), ['x1', 'x2', 'x10']);
  eq(variables(parse('a + b').ast), ['a', 'b']);
});

test('parser: pedici', () => {
  eq(variables(parse('A_{in}B + A_in\'').ast), ['A_in', 'B']);
  eq(variables(parse('A_inB').ast), ['A_inB']);
  eq(variables(parse('A_1 + A1 + B_{12}C').ast), ['A1', 'B12', 'C']);
  eq(variables(parse('BC_en').ast), ['B', 'C_en']);
  eq(variables(parse('not_1 + x').ast), ['n', 'o', 't1', 'x']);
  eq(parse('Y_{out} = A').output, 'Y_out');
  eq(parse('Y_out = A').output, 'Y_out');
  eq(parse('Y_2 = A').output, 'Y2');
  sameFunction('not(A_{in}B_{en})', "A_in' + B_en'");
  ['A_', 'A_ + B', 'A_{}', 'A_{in', 'A_{i n}', 'A1_x', '_A'].forEach(expectParseError);
});

test('nomi con pedice: HTML e SVG', () => {
  eq(varHTML('A_in'), 'A<sub>in</sub>');
  eq(varHTML('A12'), 'A<sub>12</sub>');
  eq(varHTML('Out'), 'Out');
  eq(toHTML(parse('A_{in}B + C').ast), 'A<sub>in</sub>·B + C');
  const r = synth('Y_{out} = not(A_{in} + B)');
  const svg = renderCircuit(r);
  assert(/>A<tspan[^>]*>in<\/tspan><\/text>/.test(svg), 'pedice del segnale mancante nello schema');
  assert(/>Y<tspan[^>]*>out<\/tspan><\/text>/.test(svg), 'pedice dell’uscita mancante nello schema');
});

test('parser: errori con posizione', () => {
  ['A+', '(A+B', 'A+B)', 'A $ B', '', 'Y = ', '()', 'and A', 'A + * B', 'nand A'].forEach(expectParseError);
  try {
    parse('Y = A + $');
  } catch (e) {
    eq(e.pos, 8, 'posizione errore');
  }
});

// -------------------------------------------------------------------- sintesi

test('sintesi: Y = not(A + BCD)', () => {
  const r = synth('Y = not(A + BCD)');
  eq(r.mode, 'direct');
  eq(shape(r.pdn), 'P(A,S(B,C,D))');
  eq(shape(r.pun), 'S(A,P(B,C,D))');
  eq(r.counts, { gate: 8, inInv: 0, outInv: 0, total: 8 });
});

test('sintesi: porte elementari', () => {
  const cases = {
    'not(A)': ['A', 'A', 2],
    'not(AB)': ['S(A,B)', 'P(A,B)', 4],
    'not(A+B)': ['P(A,B)', 'S(A,B)', 4],
    'not(AB+C)': ['P(S(A,B),C)', 'S(P(A,B),C)', 6],
    'not((A+B)(C+D))': ['S(P(A,B),P(C,D))', 'P(S(A,B),S(C,D))', 8],
  };
  for (const [src, [pdn, pun, total]] of Object.entries(cases)) {
    const r = synth(src);
    eq([shape(r.pdn), shape(r.pun), r.counts.total], [pdn, pun, total], src);
  }
});

test('sintesi: AND/OR usano l’invertitore d’uscita', () => {
  const or = synth('A + B');
  eq([or.mode, shape(or.pdn), or.counts.total], ['outinv', 'P(A,B)', 6]);
  const and = synth('AB');
  eq([and.mode, shape(and.pdn), and.counts.total], ['outinv', 'S(A,B)', 6]);
  const forced = synth('A + B', { mode: 'direct' });
  eq([shape(forced.pdn), forced.inverted, forced.counts.total], ["S(A',B')", ['A', 'B'], 8]);
});

test('sintesi: XOR e ingressi negati', () => {
  const r = synth("AB' + A'B");
  eq(r.mode, 'direct');
  eq(r.inverted, ['A', 'B']);
  eq(r.counts.total, 12);
  eq(synth("AB' + A'B", { complementsAvailable: true }).counts.total, 8);
});

test('sintesi: funzioni costanti rifiutate', () => {
  for (const s of ["A + A'", "AA'", '1', 'A + 1']) {
    let msg = '';
    try { synth(s); } catch (e) { msg = e.message; }
    assert(/costante|variabili/.test(msg), `"${s}" doveva essere rifiutata`);
  }
});

test('sintesi: esempi e modalità verificati sulla tabella di verità', () => {
  const exprs = ['Y = not(A + BCD)', 'not(A)', 'not(AB)', 'A + B', 'AB', "AB' + A'B", 'xnor(A, B)',
    "S'A + SB", 'not(AB + C(A + B))', 'A ^ B ^ C', 'not((A + B)(C + D))', 'A1B1 + A2B2', 'A + A\'B'];
  for (const src of exprs) {
    for (const mode of ['auto', 'direct', 'outinv']) {
      for (const complementsAvailable of [false, true]) {
        checkCircuit(synth(src, { mode, complementsAvailable }), `${src} [${mode}]`);
      }
    }
  }
});

// Generatore pseudo-casuale deterministico
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('sintesi: 400 espressioni casuali', () => {
  const rand = rng(12345);
  const names = ['A', 'B', 'C', 'D'];
  const gen = (d) => {
    const r = rand();
    if (d === 0 || r < 0.25) return names[Math.floor(rand() * names.length)];
    if (r < 0.4) return `not(${gen(d - 1)})`;
    const op = [' + ', '·', ' ^ ', ''][Math.floor(rand() * 4)];
    return `(${gen(d - 1)}${op}${op === '' ? ' ' : ''}${gen(d - 1)})`;
  };
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const src = gen(4);
    for (const mode of ['auto', 'direct', 'outinv']) {
      let r;
      try {
        r = synth(src, { mode });
      } catch (e) {
        if (/troppi/.test(e.message)) continue; // XOR annidati: circuito troppo grande da disegnare
        assert(/costante/.test(e.message), `${src}: ${e.message}`);
        const values = table(src).values;
        assert(values.every((v) => v === values[0]), `${src}: dichiarata costante ma non lo è`);
        continue;
      }
      checkCircuit(r, src);
      checked++;
    }
  }
  assert(checked > 500, `troppo poche espressioni verificate (${checked})`);
});

// ------------------------------------------------------------ dimensionamento

test('dimensionamento W/L', () => {
  const sizes = (src, ratio = 2) => {
    const r = synth(src);
    const list = (net, unit) => {
      const m = sizeNetwork(net, unit);
      const out = [];
      (function walk(n) {
        if (n.type === 'T') out.push(`${n.input}=${m.get(n.id)}`);
        else n.children.forEach(walk);
      })(net);
      return out.join(' ');
    };
    return [list(r.pdn, 1), list(r.pun, ratio)];
  };
  eq(sizes('not(AB)'), ['A=2 B=2', 'A=2 B=2']);
  eq(sizes('not(A+B)'), ['A=1 B=1', 'A=4 B=4']);
  eq(sizes('not(A + BCD)'), ['A=1 B=3 C=3 D=3', 'A=4 B=4 C=4 D=4']);
  eq(sizes('not(A(B+C))', 2.5), ['A=2 B=2 C=2', 'A=2.5 B=5 C=5']);
});

test('sforzo logico g', () => {
  const g = (src, ratio = 2) => logicalEffort(synth(src), ratio)
    .map((s) => `${s.input}${s.neg ? "'" : ''}=${s.wn}+${s.wp}=${Math.round(s.g * 1000) / 1000}`)
    .join(' ');
  eq(g('not(A)'), 'A=1+2=1');
  eq(g('not(AB)'), 'A=2+2=1.333 B=2+2=1.333'); // NAND2: 4/3
  eq(g('not(A+B)'), 'A=1+4=1.667 B=1+4=1.667'); // NOR2: 5/3
  eq(g('not(ABC)'), 'A=3+2=1.667 B=3+2=1.667 C=3+2=1.667'); // NAND3: 5/3
  eq(g('not(A + BCD)'), 'A=1+4=1.667 B=3+4=2.333 C=3+4=2.333 D=3+4=2.333');
  eq(g("AB' + A'B"), "A=2+4=2 A'=2+4=2 B=2+4=2 B'=2+4=2");
  eq(g('not(AB)', 2.5), 'A=2+2.5=1.286 B=2+2.5=1.286'); // 4.5 / 3.5
  // un segnale che pilota più transistor somma tutte le larghezze
  eq(g('not(AB + C(A + B))'), 'A=4+12=5.333 B=4+12=5.333 C=2+4=2');
  // l'ordine dei rami non cambia il dimensionamento
  const r = synth('not(A + BCD)');
  const reordered = { ...r, pdn: applyOrder(r.pdn, { Ng1: [1, 0], Ng2: [2, 1, 0] }) };
  eq(logicalEffort(reordered, 2), logicalEffort(r, 2));
});

// ------------------------------------------------------------ ordine dei rami

test('ordine: permutazioni applicate a serie e parallelo', () => {
  const r = synth('Y = not(A + BCD)');
  // PDN: P(A, S(B,C,D)) -> gruppi Ng1 (parallelo) e Ng2 (serie)
  eq([r.pdn.id, r.pdn.children[1].id], ['Ng1', 'Ng2']);
  const perms = { Ng1: [1, 0], Ng2: [2, 0, 1], Pg2: [1, 2, 0] };
  const pdn = applyOrder(r.pdn, perms);
  const pun = applyOrder(r.pun, perms);
  eq(shape(pdn), 'P(S(D,B,C),A)');
  eq(shape(pun), 'S(A,P(C,D,B))');
  eq(shape(r.pdn), 'P(A,S(B,C,D))', 'la rete originale non va modificata:');
  eq(toHTML(networkExpr(pdn)), 'DBC + A');
  checkCircuit({ ...r, pdn, pun }, 'rete riordinata');
});

test('ordine: permutazioni non valide ignorate', () => {
  const r = synth('not(AB + C)');
  const perms = { Ng1: [0, 0], Ng2: [1, 0, 2], Ng9: [1, 0], Pg1: [1, 0], Pg2: [0, 1] };
  // Ng1: non è una permutazione; Ng2: lunghezza errata; Ng9: non esiste; Pg2: identità
  eq(normalizeOrder([r.pdn, r.pun], perms), { Pg1: [1, 0] });
  eq(shape(applyOrder(r.pdn, perms)), 'P(S(A,B),C)');
});

test('ordine: ricerca dei nodi', () => {
  const r = synth('Y = not(A + BCD)');
  const found = locate(r.pdn, 'N3'); // C, secondo della serie B-C-D
  eq([found.node.input, found.parent.id, found.index], ['C', 'Ng2', 1]);
  eq(locate(r.pdn, 'Ng1').parent, null);
  eq(locate(r.pdn, 'P1'), null);
});

test('ordine: il disegno segue la permutazione', () => {
  const r = synth('not(AB)');
  const svg = (pdn) => renderCircuit({ ...r, pdn });
  const order = (s) => [...s.matchAll(/data-id="(N\d)"/g)].map((m) => m[1]).join(',');
  eq(order(svg(r.pdn)), 'N1,N2');
  eq(order(svg(applyOrder(r.pdn, { Ng1: [1, 0] }))), 'N2,N1');
  assert(/data-node="Ng1"/.test(svg(r.pdn)), 'manca il gruppo della serie');
});

// ---------------------------------------------------------------------- disegno

test('disegno: un simbolo per ogni transistor', () => {
  for (const [src, opts] of [['Y = not(A + BCD)', {}], ["AB' + A'B", {}], ["AB' + A'B", { complementsAvailable: true }], ['A + B', {}]]) {
    const r = synth(src, opts);
    const svg = renderCircuit(r, { sizing: true, ratio: 2 });
    const count = (svg.match(/class="cm-tr /g) || []).length;
    eq(count, r.counts.total, `${src}: transistor disegnati`);
    assert(!/NaN|undefined/.test(svg), `${src}: coordinate non valide nell'SVG`);
  }
});

export function run() {
  return tests.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e.message };
    }
  });
}
