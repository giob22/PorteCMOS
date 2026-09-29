import { parse, ParseError } from './parser.js';
import { toHTML, varHTML, toNNF, simplify } from './logic.js';
import {
  synthesize, simulate, truthTable, depth, applyOrder, normalizeOrder, locate, networkExpr,
} from './cmos.js';
import { renderCircuit, fixOverlines } from './render.js';

const $ = (sel) => document.querySelector(sel);

const EXAMPLES = [
  { name: 'Y = not(A + BCD)', expr: 'Y = not(A + BCD)' },
  { name: 'INV', expr: 'Y = not(A)' },
  { name: 'NAND2', expr: 'Y = not(AB)' },
  { name: 'NOR2', expr: 'Y = not(A + B)' },
  { name: 'NAND3', expr: 'Y = not(ABC)' },
  { name: 'NOR3', expr: 'Y = not(A + B + C)' },
  { name: 'AOI21', expr: 'Y = not(AB + C)' },
  { name: 'AOI22', expr: 'Y = not(AB + CD)' },
  { name: 'OAI21', expr: 'Y = not((A + B)C)' },
  { name: 'OAI22', expr: 'Y = not((A + B)(C + D))' },
  { name: 'AND2', expr: 'Y = AB' },
  { name: 'OR2', expr: 'Y = A + B' },
  { name: 'XOR', expr: "Y = AB' + A'B" },
  { name: 'XNOR', expr: 'Y = xnor(A, B)' },
  { name: 'MUX 2:1', expr: "Y = S'A + SB" },
  { name: 'Carry (maggioranza)', expr: 'Y = not(AB + C(A + B))' },
  { name: 'Con pedici', expr: 'Y_{out} = not(A_{in} + B_1C_2)' },
];

const MODE_LABELS = {
  direct: 'porta complessa',
  outinv: 'porta complessa + invertitore d’uscita',
};

const TABLE_MAX_INPUTS = 8;
const STORAGE_KEY = 'porte-cmos-options';

const state = {
  expr: EXAMPLES[0].expr,
  mode: 'auto',
  inverters: true,
  sizing: false,
  ratio: 2,
  sim: false,
  env: {},
  base: null, // risultato di synthesize(), reti nell'ordine originale
  result: null, // come base, ma con le reti nell'ordine scelto dall'utente
  perms: {}, // ordine personalizzato dei rami (vedi applyOrder)
  orderSig: null, // funzione a cui si riferisce perms; null = da confermare
  selected: null, // id del transistor o del blocco selezionato
};

const encodeOrder = (perms) => Object.entries(perms).map(([id, p]) => [id, ...p].join('.')).join('~');

function decodeOrder(text) {
  const perms = {};
  for (const part of text.split('~')) {
    const [id, ...idx] = part.split('.');
    if (/^[NP]g\d+$/.test(id) && idx.length) perms[id] = idx.map(Number);
  }
  return perms;
}

// ------------------------------------------------------------ persistenza

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const k of ['mode', 'inverters', 'sizing', 'ratio']) {
      if (k in saved) state[k] = saved[k];
    }
  } catch { /* storage non disponibile */ }
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('f')) state.expr = params.get('f');
  if (params.get('m') in MODE_LABELS) state.mode = params.get('m');
  if (params.get('o')) state.perms = decodeOrder(params.get('o'));
}

function saveState() {
  try {
    const { mode, inverters, sizing, ratio } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, inverters, sizing, ratio }));
  } catch { /* storage non disponibile */ }
  const params = new URLSearchParams({ f: state.expr });
  if (state.mode !== 'auto') params.set('m', state.mode);
  if (Object.keys(state.perms).length) params.set('o', encodeOrder(state.perms));
  history.replaceState(null, '', `#${params}`);
}

// ------------------------------------------------------------------ utilità

const escapeHTML = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ update

function update() {
  const input = $('#expr');
  markActiveExample();
  let result;
  try {
    const { output, ast } = parse(state.expr);
    result = synthesize(ast, output, { mode: state.mode, complementsAvailable: !state.inverters });
  } catch (err) {
    showError(err);
    $('#schematic').classList.add('stale');
    return;
  }
  input.classList.remove('invalid');
  $('#error').hidden = true;
  $('#schematic').classList.remove('stale');

  // l'ordine personalizzato vale finché non cambia la funzione realizzata
  const sig = `${result.mode}|${JSON.stringify(result.F)}`;
  if (state.orderSig !== null && state.orderSig !== sig) {
    state.perms = {};
    state.selected = null;
  }
  state.orderSig = sig;
  state.base = result;
  state.perms = normalizeOrder([result.pdn, result.pun], state.perms);
  state.result = orderedResult();
  if (state.selected && !findSelected()) state.selected = null;

  const env = {};
  result.inputs.forEach((v) => { env[v] = state.env[v] ?? 0; });
  state.env = env;

  drawCircuit();
  renderAnalysis();
  renderTruthTable();
  renderSimPanel();
  renderOrderPanel();
  saveState();
}

function orderedResult() {
  const { base, perms } = state;
  return { ...base, pdn: applyOrder(base.pdn, perms), pun: applyOrder(base.pun, perms) };
}

function showError(err) {
  $('#expr').classList.add('invalid');
  const box = $('#error');
  box.hidden = false;
  if (err instanceof ParseError) {
    const s = state.expr;
    const pos = Math.min(err.pos, s.length);
    const len = Math.max(1, err.length);
    const marked = pos >= s.length
      ? `${escapeHTML(s)}<mark>&nbsp;</mark>`
      : `${escapeHTML(s.slice(0, pos))}<mark>${escapeHTML(s.slice(pos, pos + len))}</mark>${escapeHTML(s.slice(pos + len))}`;
    box.innerHTML = `${escapeHTML(err.message)}<pre>${marked}</pre>`;
  } else {
    box.textContent = err.message;
  }
}

function drawCircuit() {
  const host = $('#schematic');
  host.innerHTML = renderCircuit(state.result, { sizing: state.sizing, ratio: state.ratio });
  const svg = host.querySelector('svg');
  // i circuiti piccoli non vanno ingranditi a dismisura
  svg.style.maxWidth = `${svg.viewBox.baseVal.width * 1.7}px`;
  fixOverlines(svg);
  applySimulation();
  drawSelection();
  $('#schematic-card').classList.toggle('size-on', state.sizing);
}

// ------------------------------------------------------ ordine dei MOSFET

function findSelected() {
  if (!state.selected || !state.result) return null;
  for (const net of ['pdn', 'pun']) {
    const found = locate(state.result[net], state.selected);
    if (found) return { ...found, net };
  }
  return null;
}

function select(id) {
  state.selected = id;
  drawSelection();
  renderOrderPanel();
}

/** Rettangolo tratteggiato attorno all'elemento selezionato (escluso dalle esportazioni). */
function drawSelection() {
  const svg = $('#schematic svg');
  if (!svg) return;
  svg.querySelector('.cm-selbox')?.remove();
  if (!state.selected) return;
  const el = svg.querySelector(`[data-id="${state.selected}"], [data-node="${state.selected}"]`);
  if (!el) return;
  const box = el.getBBox();
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  const attrs = {
    class: 'cm-selbox', x: box.x - 7, y: box.y - 5, width: box.width + 14, height: box.height + 10, rx: 8,
    fill: 'rgba(67, 56, 202, .08)', stroke: '#4338ca', 'stroke-width': 1.6, 'stroke-dasharray': '6 4',
    'pointer-events': 'none',
  };
  for (const [k, v] of Object.entries(attrs)) rect.setAttribute(k, v);
  svg.insertBefore(rect, svg.children[2] || null); // dopo <style> e sfondo, dietro allo schema
}

function moveSelected(delta) {
  const sel = findSelected();
  if (!sel || !sel.parent) return;
  const { parent, index } = sel;
  const target = index + delta;
  if (target < 0 || target >= parent.children.length) return;
  const perm = state.perms[parent.id] ? [...state.perms[parent.id]] : parent.children.map((_, k) => k);
  [perm[index], perm[target]] = [perm[target], perm[index]];
  state.perms[parent.id] = perm;
  orderChanged();
}

function orderChanged() {
  state.perms = normalizeOrder([state.base.pdn, state.base.pun], state.perms);
  state.result = orderedResult();
  drawCircuit();
  renderAnalysis();
  renderOrderPanel();
  saveState();
}

const literalHTML = (t) => (t.neg ? `<span class="ol">${varHTML(t.input)}</span>` : varHTML(t.input));

// Struttura di un blocco: "B – C – D" per la serie, "B ∥ C" per il parallelo
function blockHTML(n, nested = false) {
  if (n.type === 'T') return literalHTML(n);
  const s = n.children.map((c) => blockHTML(c, true)).join(n.type === 'S' ? ' – ' : ' ∥ ');
  return nested ? `(${s})` : s;
}

function renderOrderPanel() {
  const panel = $('#order-panel');
  const custom = Object.keys(state.perms).length > 0;
  const resetBtn = custom
    ? '<button type="button" class="btn ghost small" data-act="reset" title="Torna all’ordine ricavato dall’espressione">Ripristina ordine</button>'
    : '';
  const sel = findSelected();
  if (!sel) {
    panel.hidden = !custom;
    panel.innerHTML = `<span class="order-info">Ordine dei MOSFET personalizzato</span><div class="order-actions">${resetBtn}</div>`;
    return;
  }

  const { node, parent, index, net } = sel;
  const pdn = net === 'pdn';
  const tag = `<span class="tag ${pdn ? 'n' : 'p'}">${pdn ? 'NMOS' : 'PMOS'}</span>`;
  const what = node.type === 'T'
    ? `${tag} <b class="math">${literalHTML(node)}</b>`
    : `${tag} <span>blocco ${node.type === 'S' ? 'serie' : 'parallelo'}</span> <b class="math">${blockHTML(node)}</b>`;

  let where;
  if (!parent) {
    where = 'è l’intera rete: non ha rami con cui scambiarsi';
  } else if (parent.type === 'S') {
    where = `in serie, posizione ${index + 1} di ${parent.children.length} ${pdn ? '(dall’uscita verso GND)' : '(da V<sub>DD</sub> verso l’uscita)'}`;
  } else {
    where = `in parallelo, ramo ${index + 1} di ${parent.children.length} (da sinistra)`;
  }

  const series = !parent || parent.type === 'S';
  const last = parent ? parent.children.length - 1 : 0;
  const hasBlock = parent && locate(state.result[net], parent.id).parent;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="order-info">${what}<span class="where">rete di pull-${pdn ? 'down' : 'up'} · ${where}</span></div>
    <div class="order-actions">
      <button type="button" class="btn ghost small" data-act="prev" ${parent && index > 0 ? '' : 'disabled'}>${series ? '↑ Su' : '← Sinistra'}</button>
      <button type="button" class="btn ghost small" data-act="next" ${parent && index < last ? '' : 'disabled'}>${series ? '↓ Giù' : '→ Destra'}</button>
      <button type="button" class="btn ghost small" data-act="parent" ${hasBlock ? '' : 'disabled'}
        title="Seleziona il blocco che contiene questo elemento, per spostarlo tutto insieme">Seleziona blocco</button>
      ${resetBtn}
      <button type="button" class="btn ghost small" data-act="close" title="Deseleziona (Esc)" aria-label="Deseleziona">✕</button>
    </div>`;
}

// ------------------------------------------------------------- simulazione

function applySimulation() {
  const svg = $('#schematic svg');
  const card = $('#schematic-card');
  card.classList.toggle('sim-on', state.sim);
  if (!svg) return;
  svg.classList.toggle('cm-sim', state.sim);
  if (!state.sim) return;

  const sim = simulate(state.result, state.env);
  svg.querySelectorAll('.cm-tr').forEach((g) => {
    const s = sim.states[g.dataset.id] || {};
    g.classList.toggle('on', !!s.on);
    g.classList.toggle('path', !!s.path);
  });
  const values = { gate: sim.gateOut, out: sim.out };
  for (const [name, v] of Object.entries(state.env)) {
    values[`in:${name}`] = v;
    values[`inv:${name}`] = 1 - v;
  }
  svg.querySelectorAll('.cm-val').forEach((t) => {
    const v = values[t.dataset.node];
    t.textContent = v === undefined ? '' : `= ${v}`;
    t.classList.remove('cm-v0', 'cm-v1', 'cm-vx');
    t.classList.add(v === 1 ? 'cm-v1' : v === 0 ? 'cm-v0' : 'cm-vx');
  });

  const outEl = $('#sim-out-val');
  if (outEl) {
    outEl.innerHTML = `${varHTML(state.result.output)} = ${sim.out}`;
    outEl.className = `val ${sim.out === 1 ? 'v1' : sim.out === 0 ? 'v0' : 'vx'}`;
    $('#sim-status').textContent = `pull-up ${sim.up ? 'ON' : 'OFF'} · pull-down ${sim.down ? 'ON' : 'OFF'}`;
  }
  document.querySelectorAll('.tt tbody tr').forEach((tr) => {
    tr.classList.toggle('current', Number(tr.dataset.index) === currentIndex());
  });
}

function currentIndex() {
  const { inputs } = state.result;
  return inputs.reduce((acc, v) => (acc << 1) | state.env[v], 0);
}

function renderSimPanel() {
  const panel = $('#sim-panel');
  panel.hidden = !state.sim;
  if (!state.sim) return;
  const bits = state.result.inputs.map((v) => {
    const b = state.env[v];
    return `<button type="button" class="bit" data-var="${v}" title="Cambia ${v}">${varHTML(v)}<span class="v b${b}">${b}</span></button>`;
  }).join('');
  panel.innerHTML = `
    <div class="bits">${bits}</div>
    <span class="hint">clicca un ingresso per cambiarlo</span>
    <div class="sim-out"><span id="sim-status"></span><span class="val" id="sim-out-val"></span></div>`;
  applySimulation();
}

function setSim(on) {
  state.sim = on;
  $('#opt-sim').checked = on;
  renderSimPanel();
  applySimulation();
}

// ----------------------------------------------------------------- analisi

function renderAnalysis() {
  const r = state.result;
  const out = varHTML(r.output);
  const outBar = `<span class="ol">${out}</span>`;
  const node = r.mode === 'outinv' ? outBar : out;
  // le formule seguono l'ordine dei rami scelto per il disegno
  const fExpr = networkExpr(r.pdn);
  const F = toHTML(fExpr);
  const nmos = r.counts.total / 2; // ogni NMOS ha il suo PMOS complementare

  let intro;
  if (r.mode === 'direct') {
    intro = `<p>Una porta CMOS complementare realizza sempre il complemento di una funzione:
      ${out} = <span class="ol">F</span>, con</p>`;
  } else {
    intro = `<p>Si realizza prima ${outBar} = <span class="ol">F</span> con una porta complessa,
      poi un invertitore d’uscita fornisce ${out}. Qui</p>`;
  }

  let negated = '';
  if (r.inverted.length) {
    const list = r.inverted.map((v) => `<span class="ol">${varHTML(v)}</span>`).join(', ');
    negated = r.complementsAvailable
      ? `<p class="note">Ingressi negati usati: ${list} (considerati già disponibili).</p>`
      : `<p class="note">Ingressi negati: ${list} → ${r.inverted.length} invertitor${r.inverted.length > 1 ? 'i' : 'e'} (${r.counts.inInv} transistor).</p>`;
  }

  const alt = r.alternative;
  const altNote = `<p class="note">Realizzazione: ${MODE_LABELS[r.mode]}. Alternativa (${MODE_LABELS[alt.mode]}): ${alt.counts.total} transistor.</p>`;

  $('#analysis').innerHTML = `
    <h2>Analisi</h2>
    <div class="math big">${out} = ${toHTML(r.ast)}</div>
    ${intro}
    <div class="formula math">F = ${F}</div>

    <h3><span class="tag n">NMOS</span> Rete di pull-down</h3>
    <p>Tra ${node} e GND, conduce quando F = 1. AND → serie, OR → parallelo.</p>
    <div class="formula math">${F}</div>

    <h3><span class="tag p">PMOS</span> Rete di pull-up</h3>
    <p>Tra V<sub>DD</sub> e ${node}: rete duale (serie ↔ parallelo) con la struttura</p>
    <div class="formula math">${toHTML(networkExpr(r.pun))}</div>
    <p>I PMOS conducono con ingresso a 0, quindi la rete conduce quando
      <span class="math"><span class="ol">F</span> = ${toHTML(simplify(toNNF(fExpr, true)))}</span> = 1.</p>
    ${negated}

    <div class="stats">
      <div class="stat"><b>${r.counts.total}</b><span>transistor totali</span></div>
      <div class="stat"><b>${nmos} + ${nmos}</b><span>NMOS + PMOS</span></div>
      <div class="stat"><b>${depth(r.pdn)} / ${depth(r.pun)}</b><span>max in serie PDN / PUN</span></div>
    </div>
    ${altNote}`;
}

// ------------------------------------------------------- tabella di verità

function renderTruthTable() {
  const r = state.result;
  const rows = truthTable(r);
  const allOk = rows.every((row) => row.ok);
  const box = $('#truth');
  const verify = allOk
    ? `<div class="verify ok">✓ Il circuito realizza la funzione in tutte le ${rows.length} combinazioni</div>`
    : `<div class="verify bad">✗ Errore: il circuito non coincide con la funzione</div>`;

  if (r.inputs.length > TABLE_MAX_INPUTS) {
    box.innerHTML = `<div class="card-head"><h2>Tabella di verità</h2></div>${verify}
      <p class="note" style="color:var(--muted)">Con ${r.inputs.length} ingressi la tabella (${rows.length} righe) non viene mostrata.</p>`;
    return;
  }

  const out = varHTML(r.output);
  const head = r.inputs.map((v) => `<th>${varHTML(v)}</th>`).join('');
  const body = rows.map((row) => {
    const cells = r.inputs.map((v) => `<td>${row.env[v]}</td>`).join('');
    const onOff = (b) => (b ? '<span class="on">ON</span>' : '<span class="off">off</span>');
    return `<tr data-index="${row.index}">${cells}<td class="sep">${onOff(row.up)}</td><td>${onOff(row.down)}</td><td class="sep y${row.out}">${row.out}</td></tr>`;
  }).join('');

  box.innerHTML = `
    <div class="card-head"><h2>Tabella di verità</h2></div>
    ${verify}
    <div class="table-wrap">
      <table class="tt">
        <thead><tr>${head}<th class="sep">PUN</th><th>PDN</th><th class="sep">${out}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="note" style="color:var(--muted);margin:8px 0 0">Clicca una riga per simularla sullo schema.</p>`;
  applySimulation();
}

// ------------------------------------------------------------- esportazione

function exportSVGText() {
  const svg = $('#schematic svg');
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  clone.querySelectorAll('.cm-selbox').forEach((el) => el.remove());
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

const fileBase = () => `cmos-${state.result ? state.result.output : 'Y'}`;

function exportSVG() {
  const text = exportSVGText();
  if (text) download(new Blob([text], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
}

/** Rasterizza lo schema visualizzato in un PNG, `scale` volte la dimensione naturale. */
function schematicPNG(scale) {
  return new Promise((resolve, reject) => {
    const text = exportSVGText();
    if (!text) {
      reject(new Error('Nessuno schema da esportare'));
      return;
    }
    const { width, height } = $('#schematic svg').viewBox.baseVal;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG vuoto'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Rasterizzazione non riuscita'));
    };
    img.src = url;
  });
}

async function exportPNG() {
  try {
    download(await schematicPNG(3), `${fileBase()}.png`);
  } catch {
    toast('Esportazione PNG non riuscita');
  }
}

/**
 * Copia lo schema negli appunti come immagine PNG, pronta da incollare in
 * OneNote, Word, Notion, GoodNotes… Se il browser non lo consente scarica il PNG.
 */
async function copyImage() {
  if (!state.result) return;
  if ($('#schematic').classList.contains('stale')) {
    toast('Correggi prima l’espressione: lo schema mostrato non è aggiornato');
    return;
  }
  // La promessa va passata subito a ClipboardItem: Safari accetta la scrittura
  // negli appunti solo se avviene nello stesso gesto dell'utente.
  const png = schematicPNG(2);
  const paste = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
  try {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Clipboard API non disponibile');
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast(`Schema copiato: incollalo negli appunti con ${paste}`);
  } catch {
    try {
      download(await png, `${fileBase()}.png`);
      toast('Il browser non permette di copiare immagini: PNG scaricato');
    } catch {
      toast('Copia non riuscita');
    }
  }
}

function toggleFullscreen() {
  const card = $('#schematic-card');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (card.requestFullscreen) card.requestFullscreen();
  else toast('Schermo intero non supportato da questo browser');
}

// ----------------------------------------------------------------- controlli

function markActiveExample() {
  const norm = (s) => s.replace(/\s+/g, '');
  document.querySelectorAll('#examples .chip').forEach((c) => {
    c.classList.toggle('active', norm(c.dataset.expr) === norm(state.expr));
  });
}

function syncControls() {
  $('#expr').value = state.expr;
  document.querySelectorAll('#mode button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
  });
  $('#opt-inverters').checked = state.inverters;
  $('#opt-sizing').checked = state.sizing;
  $('#opt-ratio').value = state.ratio;
  $('#opt-ratio').disabled = !state.sizing;
  $('#opt-ratio').closest('.ratio').classList.toggle('disabled', !state.sizing);
  $('#opt-sim').checked = state.sim;
}

function init() {
  loadState();

  $('#examples').innerHTML = EXAMPLES.map((e) =>
    `<button type="button" class="chip" data-expr="${escapeHTML(e.expr)}" title="${escapeHTML(e.expr)}">${escapeHTML(e.name)}</button>`,
  ).join('');

  syncControls();

  let timer;
  $('#expr').addEventListener('input', (e) => {
    state.expr = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(update, 180);
  });
  $('#expr').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      update();
    }
  });

  $('#examples').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.expr = chip.dataset.expr;
    $('#expr').value = state.expr;
    update();
  });

  $('#mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.mode;
    syncControls();
    update();
  });

  $('#opt-inverters').addEventListener('change', (e) => {
    state.inverters = e.target.checked;
    update();
  });
  $('#opt-sizing').addEventListener('change', (e) => {
    state.sizing = e.target.checked;
    syncControls();
    update();
  });
  $('#opt-ratio').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!(v > 0 && v <= 10)) return;
    state.ratio = v;
    if (state.sizing) update();
  });
  $('#opt-sim').addEventListener('change', (e) => setSim(e.target.checked));

  $('#sim-panel').addEventListener('click', (e) => {
    const b = e.target.closest('.bit');
    if (!b) return;
    state.env[b.dataset.var] ^= 1;
    renderSimPanel();
  });

  $('#truth').addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr');
    if (!tr || !state.result) return;
    const index = Number(tr.dataset.index);
    const n = state.result.inputs.length;
    state.result.inputs.forEach((v, k) => { state.env[v] = (index >> (n - 1 - k)) & 1; });
    if (!state.sim) setSim(true);
    else renderSimPanel();
  });

  // clic su un MOSFET delle reti: lo seleziona (un secondo clic lo deseleziona)
  $('#schematic').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-movable]');
    if (tr) select(state.selected === tr.dataset.id ? null : tr.dataset.id);
    else if (state.selected) select(null);
  });

  $('#order-panel').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'prev': moveSelected(-1); break;
      case 'next': moveSelected(1); break;
      case 'parent': {
        const sel = findSelected();
        if (sel && sel.parent) select(sel.parent.id);
        break;
      }
      case 'reset':
        state.perms = {};
        orderChanged();
        break;
      default: select(null);
    }
  });

  $('#export-svg').addEventListener('click', exportSVG);
  $('#export-png').addEventListener('click', exportPNG);
  $('#copy-img').addEventListener('click', copyImage);
  $('#fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    $('#fullscreen').textContent = document.fullscreenElement ? 'Esci (Esc)' : 'Schermo intero';
  });
  const ARROWS = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select');
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.selected && e.key in ARROWS) {
      e.preventDefault();
      moveSelected(ARROWS[e.key]);
      return;
    }
    if (state.selected && e.key === 'Escape') {
      select(null);
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'f') toggleFullscreen();
    else if (key === 'c') copyImage();
  });

  $('#copy-link').addEventListener('click', async () => {
    saveState();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copiato negli appunti');
    } catch {
      toast('Copia non riuscita: usa la barra degli indirizzi');
    }
  });

  window.addEventListener('hashchange', () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const f = params.get('f');
    const o = params.get('o') || '';
    if (f && (f !== state.expr || o !== encodeOrder(state.perms))) {
      state.expr = f;
      state.perms = decodeOrder(o);
      state.orderSig = null; // l'ordine del link vale per la nuova funzione
      syncControls();
      update();
    }
  });

  update();
}

init();
