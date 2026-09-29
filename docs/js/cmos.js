// Sintesi di una porta CMOS statica complementare a partire da un'espressione.
//
// Una porta complessa CMOS realizza sempre Y = NOT(F):
//   - rete di pull-down (NMOS) tra uscita e GND: AND -> serie, OR -> parallelo
//   - rete di pull-up   (PMOS) tra VDD e uscita: rete duale (serie <-> parallelo)
// I letterali negati di F richiedono un invertitore sull'ingresso; se Y non è
// nella forma NOT(F) conviene realizzare NOT(Y) e aggiungere un invertitore
// d'uscita. In modalità automatica si sceglie la soluzione con meno transistor.
//
// Reti serie-parallelo:
//   { type: 'T', kind: 'n' | 'p', input, neg, id }   transistor
//   { type: 'S', id, children }                      serie
//   { type: 'P', id, children }                      parallelo
// Gli id dipendono solo dalla funzione F, quindi restano stabili tra un
// disegno e l'altro e permettono di ricordare l'ordine scelto dall'utente.

import { variables, evaluate, toNNF, simplify, dual } from './logic.js';

export const MAX_INPUTS = 12;
export const MAX_TRANSISTORS = 300;

export const inverterIds = (name) => ({ p: `IP_${name}`, n: `IN_${name}` });
export const OUTPUT_INVERTER_IDS = { p: 'OUT_P', n: 'OUT_N' };

export function inputVector(inputs, index) {
  const env = {};
  inputs.forEach((name, k) => {
    env[name] = (index >> (inputs.length - 1 - k)) & 1;
  });
  return env;
}

function buildNetwork(f, kind, prefix) {
  let leaves = 0;
  let groups = 0;
  const build = (n) => {
    switch (n.type) {
      case 'var': return { type: 'T', kind, input: n.name, neg: false, id: `${prefix}${++leaves}` };
      case 'not': return { type: 'T', kind, input: n.arg.name, neg: true, id: `${prefix}${++leaves}` };
      case 'and': return { type: 'S', id: `${prefix}g${++groups}`, children: n.args.map(build) };
      case 'or': return { type: 'P', id: `${prefix}g${++groups}`, children: n.args.map(build) };
      default: throw new Error(`Nodo inatteso nella NNF: ${n.type}`);
    }
  };
  return build(f);
}

// ------------------------------------------------------ ordine dei rami
//
// L'ordine personalizzato è una mappa { idGruppo: permutazione }, dove la
// permutazione elenca, nell'ordine in cui vanno disegnati, gli indici dei
// figli nell'ordine originale. Serie: dall'alto in basso; parallelo: da
// sinistra a destra.

const isPermutation = (p, n) => Array.isArray(p) && p.length === n &&
  [...p].sort((a, b) => a - b).every((v, i) => v === i);

/** Copia della rete con i figli dei gruppi riordinati secondo `perms`. */
export function applyOrder(net, perms) {
  if (net.type === 'T') return net;
  const kids = net.children.map((c) => applyOrder(c, perms));
  const p = perms[net.id];
  return { ...net, children: isPermutation(p, kids.length) ? p.map((i) => kids[i]) : kids };
}

/** Tiene solo le permutazioni valide per le reti date e diverse dall'identità. */
export function normalizeOrder(nets, perms) {
  const out = {};
  const visit = (n) => {
    if (n.type === 'T') return;
    const p = perms[n.id];
    if (isPermutation(p, n.children.length) && p.some((v, i) => v !== i)) out[n.id] = p;
    n.children.forEach(visit);
  };
  nets.forEach(visit);
  return out;
}

/** Cerca un nodo per id: { node, parent, index }, con parent null per la radice. */
export function locate(net, id, parent = null, index = 0) {
  if (net.id === id) return { node: net, parent, index };
  if (net.type === 'T') return null;
  for (let i = 0; i < net.children.length; i++) {
    const found = locate(net.children[i], id, net, i);
    if (found) return found;
  }
  return null;
}

/** Espressione (AND = serie, OR = parallelo) che descrive la struttura della rete. */
export function networkExpr(net) {
  if (net.type === 'T') {
    const v = { type: 'var', name: net.input };
    return net.neg ? { type: 'not', arg: v } : v;
  }
  return { type: net.type === 'S' ? 'and' : 'or', args: net.children.map(networkExpr) };
}

function literals(f) {
  if (f.type === 'var' || f.type === 'not') return [f];
  return f.args.flatMap(literals);
}

function complementedInputs(f) {
  const names = new Set(literals(f).filter((l) => l.type === 'not').map((l) => l.arg.name));
  return variables(f).filter((v) => names.has(v));
}

/**
 * @param ast     AST dell'espressione
 * @param output  nome dell'uscita (es. "Y")
 * @param mode    'auto' | 'direct' (porta complessa, eventuali ingressi negati)
 *                | 'outinv' (porta complessa che realizza Y' + invertitore d'uscita)
 * @param complementsAvailable  se true gli ingressi negati sono considerati
 *                disponibili e non si contano/disegnano gli invertitori d'ingresso
 */
export function synthesize(ast, output = 'Y', { mode = 'auto', complementsAvailable = false } = {}) {
  const inputs = variables(ast);
  if (inputs.length === 0) {
    throw new Error('L’espressione non contiene variabili: non c’è nessuna porta da realizzare.');
  }
  if (inputs.length > MAX_INPUTS) {
    throw new Error(`Troppe variabili (${inputs.length}): il massimo è ${MAX_INPUTS}.`);
  }
  const first = evaluate(ast, inputVector(inputs, 0));
  let constant = true;
  for (let i = 1; i < 1 << inputs.length && constant; i++) {
    constant = evaluate(ast, inputVector(inputs, i)) === first;
  }
  if (constant) {
    throw new Error(`La funzione è costante (${output} = ${first} per ogni ingresso): non serve alcuna porta.`);
  }

  const candidates = [
    { mode: 'direct', F: simplify(toNNF(ast, true)) }, // Y  = NOT(F)
    { mode: 'outinv', F: simplify(toNNF(ast, false)) }, // Y' = NOT(F), poi invertitore
  ].map((c) => {
    const inverted = complementedInputs(c.F);
    const gate = 2 * literals(c.F).length;
    const inInv = complementsAvailable ? 0 : 2 * inverted.length;
    const outInv = c.mode === 'outinv' ? 2 : 0;
    return { ...c, inverted, counts: { gate, inInv, outInv, total: gate + inInv + outInv } };
  });

  const chosen = mode === 'auto'
    ? (candidates[1].counts.total < candidates[0].counts.total ? candidates[1] : candidates[0])
    : candidates.find((c) => c.mode === mode);
  if (!chosen) throw new Error(`Modalità sconosciuta: ${mode}`);
  if (chosen.counts.total > MAX_TRANSISTORS) {
    throw new Error(`Il circuito richiederebbe ${chosen.counts.total} transistor: troppi da disegnare.`);
  }

  return {
    output,
    ast,
    inputs,
    mode: chosen.mode,
    F: chosen.F,
    inverted: chosen.inverted,
    counts: chosen.counts,
    alternative: candidates.find((c) => c !== chosen),
    complementsAvailable,
    pdn: buildNetwork(chosen.F, 'n', 'N'),
    pun: buildNetwork(dual(chosen.F), 'p', 'P'),
  };
}

/** Numero massimo di transistor in serie lungo un cammino della rete. */
export function depth(net) {
  if (net.type === 'T') return 1;
  const d = net.children.map(depth);
  return net.type === 'S' ? d.reduce((a, b) => a + b, 0) : Math.max(...d);
}

/**
 * Dimensionamento classico: ogni transistor ha W/L = unit × (numero di
 * transistor del cammino serie più lungo che lo attraversa), così la
 * resistenza nel caso peggiore eguaglia quella dell'invertitore di riferimento.
 * @returns {Map<string, number>} id transistor -> (W/L)
 */
export function sizeNetwork(net, unit) {
  const sizes = new Map();
  const visit = (n, extra) => {
    if (n.type === 'T') {
      sizes.set(n.id, unit * (extra + 1));
    } else if (n.type === 'P') {
      n.children.forEach((c) => visit(c, extra));
    } else {
      const d = n.children.map(depth);
      const total = d.reduce((a, b) => a + b, 0);
      n.children.forEach((c, i) => visit(c, extra + total - d[i]));
    }
  };
  visit(net, 0);
  return sizes;
}

export function conducts(net, env) {
  switch (net.type) {
    case 'T': {
      const g = env[net.input] ^ (net.neg ? 1 : 0);
      return net.kind === 'n' ? g === 1 : g === 0;
    }
    case 'S': return net.children.every((c) => conducts(c, env));
    default: return net.children.some((c) => conducts(c, env));
  }
}

// active = la sottorete fa parte di un cammino conduttivo tra alimentazione e uscita
function markNetwork(net, env, active, states) {
  if (net.type === 'T') {
    const on = conducts(net, env);
    states[net.id] = { on, path: active && on };
  } else if (net.type === 'S') {
    const pathOn = active && conducts(net, env);
    net.children.forEach((c) => markNetwork(c, env, pathOn, states));
  } else {
    net.children.forEach((c) => markNetwork(c, env, active && conducts(c, env), states));
  }
}

/**
 * Valuta il circuito a livello di transistor.
 * gateOut/out valgono 0, 1, 'X' (conflitto) o 'Z' (alta impedenza).
 */
export function evaluateCircuit(result, env) {
  const up = conducts(result.pun, env);
  const down = conducts(result.pdn, env);
  const gateOut = up && !down ? 1 : down && !up ? 0 : up ? 'X' : 'Z';
  const out = result.mode === 'outinv' && typeof gateOut === 'number' ? 1 - gateOut : gateOut;
  return { up, down, gateOut, out };
}

/** Stato (acceso / sul cammino conduttivo) di ogni transistor disegnato. */
export function simulate(result, env) {
  const circuit = evaluateCircuit(result, env);
  const states = {};
  markNetwork(result.pun, env, true, states);
  markNetwork(result.pdn, env, true, states);
  const setInverter = (ids, input) => {
    states[ids.p] = { on: input === 0, path: input === 0 };
    states[ids.n] = { on: input === 1, path: input === 1 };
  };
  if (!result.complementsAvailable) {
    result.inverted.forEach((name) => setInverter(inverterIds(name), env[name]));
  }
  if (result.mode === 'outinv') setInverter(OUTPUT_INVERTER_IDS, circuit.gateOut);
  return { ...circuit, states };
}

export function truthTable(result) {
  const rows = [];
  for (let i = 0; i < 1 << result.inputs.length; i++) {
    const env = inputVector(result.inputs, i);
    const expected = evaluate(result.ast, env);
    const circuit = evaluateCircuit(result, env);
    rows.push({ index: i, env, expected, ...circuit, ok: circuit.out === expected });
  }
  return rows;
}
