// Disegno SVG dello schema a transistor.
//
// Ogni blocco (transistor, serie, parallelo, porta) ha una "dorsale" verticale
// alla coordinata sx: il terminale superiore è in (sx, 0), quello inferiore in
// (sx, h). La serie impila i blocchi allineando le dorsali, il parallelo li
// affianca collegandoli con due bus orizzontali.

import { sizeNetwork, inverterIds, OUTPUT_INVERTER_IDS } from './cmos.js';

const G = {
  leafH: 60,
  lead: 14, // tratto di drain/source
  chX: 14, // distanza del canale dalla dorsale
  gateX: 21, // distanza dell'armatura di gate
  gateEnd: 40, // estremità del collegamento di gate
  labelGap: 5,
  bus: 16, // tratti sopra/sotto i bus di un parallelo
  gapP: 18, // spazio orizzontale tra rami in parallelo
  font: 17,
  sizeFont: 12,
  railLead: 12,
  outGap: 22, // tratto tra rete e nodo d'uscita
  outWire: 34,
  pieceGap: 44,
  pad: 18,
};

const FONT_FAMILY = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const COLORS = {
  ink: '#1e2330',
  muted: '#6b7280',
  up: '#d9412b', // cammino verso VDD (uscita a 1)
  down: '#2563eb', // cammino verso GND (uscita a 0)
  size: '#7c3aed',
};

const STYLE = `
.cm-w{fill:none;stroke:${COLORS.ink};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.cm-thick{stroke-width:3.2;stroke-linecap:butt}
.cm-dot{fill:${COLORS.ink}}
.cm-bubble{fill:#fff;stroke:${COLORS.ink};stroke-width:2}
.cm-term{fill:#fff;stroke:${COLORS.ink};stroke-width:2}
.cm-txt{font-family:${FONT_FAMILY};fill:${COLORS.ink};font-size:${G.font}px;font-weight:600}
.cm-rail{font-size:14px;font-weight:600}
.cm-sub{font-size:10px}
.cm-node{font-size:14px;fill:${COLORS.muted};font-weight:600}
.cm-ol{stroke:${COLORS.ink};stroke-width:1.6}
.cm-size{font-family:${FONT_FAMILY};font-size:${G.sizeFont}px;font-weight:700;fill:${COLORS.size}}
.cm-sizebg{fill:#f3efff;stroke:#d9ccff;stroke-width:1}
.cm-val{font-family:${FONT_FAMILY};font-size:13px;font-weight:700;display:none}
.cm-sim .cm-val{display:inline}
.cm-sim .cm-tr{opacity:.28;transition:opacity .15s}
.cm-sim .cm-tr.on{opacity:1}
.cm-sim .cm-tr.path.cm-p .cm-w,.cm-sim .cm-tr.path.cm-p .cm-bubble{stroke:${COLORS.up}}
.cm-sim .cm-tr.path.cm-p .cm-txt,.cm-sim .cm-tr.path.cm-p .cm-dot{fill:${COLORS.up}}
.cm-sim .cm-tr.path.cm-n .cm-w{stroke:${COLORS.down}}
.cm-sim .cm-tr.path.cm-n .cm-txt,.cm-sim .cm-tr.path.cm-n .cm-dot{fill:${COLORS.down}}
.cm-sim .cm-tr.path .cm-ol{stroke:currentColor}
.cm-sim .cm-tr.path.cm-p{color:${COLORS.up}}
.cm-sim .cm-tr.path.cm-n{color:${COLORS.down}}
.cm-v1{fill:${COLORS.up}}
.cm-v0{fill:${COLORS.down}}
.cm-vx{fill:#b45309}
`;

// Larghezza stimata del testo (serve solo per l'impaginazione).
const textWidth = (s, size) => s.length * size * 0.62;
const fmtNum = (x) => String(Math.round(x * 100) / 100);

const splitName = (name) => {
  const m = /^([A-Za-z])([0-9]*)$/.exec(name);
  return m ? { base: m[1], sub: m[2] } : { base: name, sub: '' };
};

function labelWidth(name, size = G.font) {
  const { base, sub } = splitName(name);
  return textWidth(base, size) + (sub ? textWidth(sub, size * 0.65) + 1 : 0);
}

/**
 * Etichetta di un segnale (con pedice per le cifre e soprassegno se negato).
 * anchor: 'start' | 'middle' | 'end'. Il soprassegno viene poi riallineato
 * sulla larghezza reale del testo da fixOverlines().
 */
function label(out, x, y, name, { neg = false, anchor = 'start', cls = 'cm-txt', size = G.font } = {}) {
  const { base, sub } = splitName(name);
  const w = labelWidth(name, size);
  const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  const subSpan = sub ? `<tspan font-size="${Math.round(size * 0.65)}" dy="4">${sub}</tspan>` : '';
  out.push(`<text class="${cls}" x="${x0}" y="${y}" dominant-baseline="central"${neg ? ' data-neg="1"' : ''}>${base}${subSpan}</text>`);
  if (neg) {
    const yl = y - size * 0.56;
    out.push(`<line class="cm-ol" x1="${x0 + 1}" y1="${yl}" x2="${x0 + w - 1}" y2="${yl}"/>`);
  }
}

const path = (out, d, cls = 'cm-w') => out.push(`<path class="${cls}" d="${d}"/>`);
const dot = (out, x, y) => out.push(`<circle class="cm-dot" cx="${x}" cy="${y}" r="3.6"/>`);

function sizeTag(out, x, y, value) {
  const txt = fmtNum(value);
  const w = textWidth(txt, G.sizeFont) + 10;
  out.push(`<rect class="cm-sizebg" x="${x}" y="${y - 9}" width="${w}" height="18" rx="5"/>`);
  out.push(`<text class="cm-size" x="${x + w / 2}" y="${y}" text-anchor="middle" dominant-baseline="central">${txt}</text>`);
}

const sizeTagWidth = (value) => textWidth(fmtNum(value), G.sizeFont) + 10;

// ---------------------------------------------------------------- transistor

function leafLayout(t, ctx, { showLabel = true } = {}) {
  const size = ctx.sizes ? ctx.sizes.get(t.id) : null;
  const left = G.gateEnd + (showLabel ? G.labelGap + labelWidth(t.input) + 4 : 2);
  const right = size != null ? 8 + sizeTagWidth(size) + 6 : 10;
  return {
    w: left + right,
    h: G.leafH,
    sx: left,
    draw(ox, oy, out) {
      const x = ox + left;
      const y = oy;
      const yg = y + G.leafH / 2;
      out.push(`<g class="cm-tr cm-${t.kind}" data-id="${t.id}">`);
      path(out, `M${x} ${y}V${y + G.lead}H${x - G.chX}M${x - G.chX} ${y + G.leafH - G.lead}H${x}V${y + G.leafH}`);
      path(out, `M${x - G.chX} ${y + 9}V${y + G.leafH - 9}`, 'cm-w cm-thick');
      path(out, `M${x - G.gateX} ${y + G.lead}V${y + G.leafH - G.lead}`, 'cm-w cm-thick');
      if (t.kind === 'p') {
        out.push(`<circle class="cm-bubble" cx="${x - G.gateX - 4.6}" cy="${yg}" r="4.2"/>`);
        path(out, `M${x - G.gateX - 8.8} ${yg}H${x - G.gateEnd}`);
      } else {
        path(out, `M${x - G.gateX} ${yg}H${x - G.gateEnd}`);
      }
      if (showLabel) label(out, x - G.gateEnd - G.labelGap, yg, t.input, { neg: t.neg, anchor: 'end' });
      if (size != null) sizeTag(out, x + 8, yg, size);
      out.push('</g>');
    },
  };
}

// ---------------------------------------------------------- serie / parallelo

function networkLayout(net, ctx) {
  if (net.type === 'T') return leafLayout(net, ctx);
  const kids = net.children.map((c) => networkLayout(c, ctx));

  if (net.type === 'S') {
    const sx = Math.max(...kids.map((k) => k.sx));
    const right = Math.max(...kids.map((k) => k.w - k.sx));
    return {
      w: sx + right,
      h: kids.reduce((a, k) => a + k.h, 0),
      sx,
      draw(ox, oy, out) {
        let y = oy;
        for (const k of kids) {
          k.draw(ox + sx - k.sx, y, out);
          y += k.h;
        }
      },
    };
  }

  // parallelo
  const xs = [];
  let cursor = 0;
  for (const k of kids) {
    xs.push(cursor);
    cursor += k.w + G.gapP;
  }
  const spines = kids.map((k, i) => xs[i] + k.sx);
  const sx = Math.round((spines[0] + spines[spines.length - 1]) / 2);
  const hMax = Math.max(...kids.map((k) => k.h));
  return {
    w: cursor - G.gapP,
    h: hMax + 2 * G.bus,
    sx,
    draw(ox, oy, out) {
      const yTop = oy + G.bus;
      const yBot = oy + G.bus + hMax;
      const first = ox + spines[0];
      const last = ox + spines[spines.length - 1];
      path(out, `M${ox + sx} ${oy}V${yTop}M${first} ${yTop}H${last}M${first} ${yBot}H${last}M${ox + sx} ${yBot}V${oy + hMax + 2 * G.bus}`);
      kids.forEach((k, i) => {
        const x = ox + spines[i];
        const top = yTop + Math.round((hMax - k.h) / 2);
        if (top > yTop) path(out, `M${x} ${yTop}V${top}`);
        if (top + k.h < yBot) path(out, `M${x} ${top + k.h}V${yBot}`);
        k.draw(ox + xs[i], top, out);
        if (i > 0 && i < kids.length - 1 && x !== ox + sx) {
          dot(out, x, yTop);
          dot(out, x, yBot);
        }
      });
      dot(out, ox + sx, yTop);
      dot(out, ox + sx, yBot);
    },
  };
}

// --------------------------------------------------------------------- porta

function vddSymbol(out, x, y) {
  path(out, `M${x - 20} ${y}H${x + 20}`, 'cm-w cm-thick');
  out.push(`<text class="cm-txt cm-rail" x="${x}" y="${y - 12}" text-anchor="middle">V<tspan class="cm-sub" dy="3">DD</tspan></text>`);
}

function gndSymbol(out, x, y) {
  path(out, `M${x - 16} ${y}H${x + 16}M${x - 10} ${y + 6}H${x + 10}M${x - 4} ${y + 12}H${x + 4}`);
}

function valueBadge(out, x, y, node, anchor = 'start') {
  out.push(`<text class="cm-val" data-node="${node}" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central"></text>`);
}

/**
 * Porta CMOS completa: VDD, rete di pull-up, nodo d'uscita, rete di pull-down, GND.
 *   input:  { name, neg, node, terminal } se i gate sono uniti in un unico
 *           ingresso (invertitore); senza terminale il filo d'ingresso arriva
 *           al bordo sinistro, dove termina l'uscita del blocco precedente
 *   output: { name, neg, node, terminal } descrizione del nodo d'uscita
 */
function gateLayout(pun, pdn, { input = null, output }) {
  let sx = Math.max(pun.sx, pdn.sx, 26);
  if (input) sx = G.gateEnd + (input.terminal ? 34 + 10 + labelWidth(input.name) + 6 : 16);
  const netRight = Math.max(pun.w - pun.sx, pdn.w - pdn.sx, 22);
  const outLen = netRight + G.outWire;
  const right = outLen + (output.terminal ? 10 + labelWidth(output.name) + 26 : 0);

  const yVdd = 30;
  const yPun = yVdd + G.railLead;
  const yOut = yPun + pun.h + G.outGap;
  const yPdn = yOut + G.outGap;
  const yGnd = yPdn + pdn.h + G.railLead;

  return {
    w: sx + right,
    h: yGnd + 16,
    yOut,
    draw(ox, oy, out) {
      const x = ox + sx;
      vddSymbol(out, x, oy + yVdd);
      path(out, `M${x} ${oy + yVdd}V${oy + yPun}`);
      pun.draw(x - pun.sx, oy + yPun, out);
      path(out, `M${x} ${oy + yPun + pun.h}V${oy + yPdn}`);
      pdn.draw(x - pdn.sx, oy + yPdn, out);
      path(out, `M${x} ${oy + yPdn + pdn.h}V${oy + yGnd}`);
      gndSymbol(out, x, oy + yGnd);

      const yo = oy + yOut;
      const xEnd = x + outLen;
      path(out, `M${x} ${yo}H${xEnd}`);
      dot(out, x, yo);
      if (output.terminal) {
        out.push(`<circle class="cm-term" cx="${xEnd + 4}" cy="${yo}" r="4"/>`);
        label(out, xEnd + 14, yo, output.name, { neg: output.neg });
        valueBadge(out, xEnd + 14, yo + 20, output.node);
      } else {
        label(out, xEnd - 12, yo - 14, output.name, { neg: output.neg, anchor: 'end', cls: 'cm-txt cm-node', size: 14 });
        valueBadge(out, xEnd - 12, yo + 14, output.node, 'end');
      }

      if (input) {
        const xg = x - G.gateEnd;
        const g1 = oy + yPun + G.leafH / 2;
        const g2 = oy + yPdn + G.leafH / 2;
        path(out, `M${xg} ${g1}V${g2}`);
        dot(out, xg, yo);
        if (input.terminal) {
          const xin = xg - 34;
          path(out, `M${xg} ${yo}H${xin}`);
          out.push(`<circle class="cm-term" cx="${xin - 4}" cy="${yo}" r="4"/>`);
          label(out, xin - 12, yo, input.name, { neg: input.neg, anchor: 'end' });
          valueBadge(out, xin - 12, yo + 20, input.node, 'end');
        } else {
          path(out, `M${xg} ${yo}H${ox}`);
        }
      }
    },
  };
}

function inverterLayout(ids, ctx, { input, output }) {
  const mk = (kind, id) => leafLayout({ type: 'T', kind, input: input.name, neg: input.neg, id }, ctx, { showLabel: false });
  return gateLayout(mk('p', ids.p), mk('n', ids.n), { input, output });
}

/**
 * Genera l'SVG del circuito.
 * @param result  risultato di synthesize()
 * @param opts    { sizing: boolean, ratio: number }
 */
export function renderCircuit(result, { sizing = false, ratio = 2 } = {}) {
  const sizes = sizing
    ? new Map([
      ...sizeNetwork(result.pdn, 1),
      ...sizeNetwork(result.pun, ratio),
    ])
    : null;
  if (sizes) {
    const addInv = (ids) => { sizes.set(ids.p, ratio); sizes.set(ids.n, 1); };
    result.inverted.forEach((name) => addInv(inverterIds(name)));
    addInv(OUTPUT_INVERTER_IDS);
  }
  const ctx = { sizes };

  const pieces = [];
  if (!result.complementsAvailable) {
    for (const name of result.inverted) {
      pieces.push({
        layout: inverterLayout(inverterIds(name), ctx, {
          input: { name, neg: false, node: `in:${name}`, terminal: true },
          output: { name, neg: true, terminal: true, node: `inv:${name}` },
        }),
        gap: G.pieceGap,
      });
    }
  }

  const outInv = result.mode === 'outinv';
  const main = gateLayout(networkLayout(result.pun, ctx), networkLayout(result.pdn, ctx), {
    output: outInv
      ? { name: result.output, neg: true, terminal: false, node: 'gate' }
      : { name: result.output, neg: false, terminal: true, node: 'out' },
  });
  pieces.push({ layout: main, gap: 0 });

  if (outInv) {
    pieces.push({
      layout: inverterLayout(OUTPUT_INVERTER_IDS, ctx, {
        input: { name: result.output, neg: true, terminal: false },
        output: { name: result.output, neg: false, terminal: true, node: 'out' },
      }),
      gap: 0,
    });
  }

  // allineamento orizzontale dei nodi d'uscita
  const yRef = Math.max(...pieces.map((p) => p.layout.yOut));
  let x = G.pad;
  let height = 0;
  const out = [];
  pieces.forEach((p, i) => {
    const oy = G.pad + yRef - p.layout.yOut;
    p.layout.draw(x, oy, out);
    height = Math.max(height, oy + p.layout.h);
    x += p.layout.w + (i < pieces.length - 1 ? p.gap : 0);
  });

  const body = out.join('');
  const width = Math.ceil(x + G.pad);
  const h = Math.ceil(height + G.pad);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" class="cm-svg" role="img" aria-label="Schema CMOS di ${result.output}"><style>${STYLE}</style><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
}

/**
 * Riallinea i soprassegni alla larghezza reale del testo (da chiamare dopo
 * l'inserimento dell'SVG nel documento).
 */
export function fixOverlines(svg) {
  svg.querySelectorAll('text[data-neg]').forEach((t) => {
    const line = t.nextElementSibling;
    if (!line || line.tagName !== 'line') return;
    let box;
    try { box = t.getBBox(); } catch { return; }
    if (!box.width) return;
    line.setAttribute('x1', box.x + 1);
    line.setAttribute('x2', box.x + box.width - 1);
  });
}
