# Porte CMOS

Scrivi una funzione logica, ad esempio `Y = not(A + BCD)`, e ottieni lo schema a
transistor della corrispondente porta CMOS statica complementare.

**Apri l’app:** https://giob22.github.io/PorteCMOS/

## Cosa fa

- **Rete di pull-down (NMOS)** tra uscita e GND: AND → serie, OR → parallelo.
- **Rete di pull-up (PMOS)** tra V<sub>DD</sub> e uscita: rete duale (serie ↔ parallelo).
- Se la funzione non è nella forma `Y = not(F)` (es. `Y = A + B`) sceglie la
  soluzione con meno transistor tra porta complessa con ingressi negati e porta
  complessa + invertitore d’uscita. La scelta si può anche forzare.
- Disegna a livello di transistor anche gli **invertitori** per gli ingressi negati
  (disattivabili se gli ingressi complementati sono già disponibili).
- **Dimensionamento W/L**: ogni transistor ha W/L = (W/L)<sub>rif</sub> × numero di
  transistor del cammino serie più lungo che lo attraversa, così il caso peggiore
  eguaglia l’invertitore di riferimento ((W/L)<sub>n</sub> = 1, (W/L)<sub>p</sub> impostabile).
- **Tabella di verità** con stato di PUN/PDN e verifica automatica del circuito.
- **Simulazione**: si assegnano gli ingressi (o si clicca una riga della tabella) e
  lo schema evidenzia i transistor accesi e il cammino verso V<sub>DD</sub> o GND.
- **Copia immagine** (tasto `C`): lo schema va negli appunti come PNG, pronto da
  incollare con Ctrl+V in OneNote, Word, Notion, GoodNotes…
- **Schermo intero** (tasto `F`) per la proiezione in aula, esportazione **SVG/PNG**,
  **link condivisibile** con la funzione nell’URL.

## Sintassi

| Operazione | Scrittura |
|---|---|
| NOT | `not(A)` `!A` `~A` `A'` |
| AND | `AB` `A·B` `A*B` `A&B` `A and B` |
| OR | `A + B` `A \| B` `A or B` |
| XOR | `A ^ B` `A xor B` |
| Funzioni | `nand(A, B)` `nor(A, B, C)` `xnor(A, B)` `and(…)` `or(…)` |

Lettere adiacenti sono in AND (`BCD` = B·C·D); una variabile è una lettera seguita
da eventuali cifre (`A1`, `S0`). Precedenza: NOT, AND, XOR, OR. Il prefisso `Y =`
è facoltativo e imposta il nome dell’uscita.

## Struttura

```
docs/            sito pubblicato su GitHub Pages (HTML/CSS/JS, nessuna build)
  js/parser.js   parser delle espressioni
  js/logic.js    NNF, De Morgan, semplificazioni, formattazione
  js/cmos.js     sintesi PUN/PDN, dimensionamento, simulazione
  js/render.js   disegno SVG dello schema
  js/app.js      interfaccia
tests/           test (Node o browser) e galleria di controllo visivo
```

## Sviluppo

Serve solo un server statico, ad esempio:

```bash
python -m http.server 8000
```

poi apri http://localhost:8000/docs/ (app), http://localhost:8000/tests/ (test) e
http://localhost:8000/tests/gallery.html (galleria degli schemi).

Con Node i test si lanciano con `node tests/run.mjs`. A ogni push su `main` il
workflow `.github/workflows/pages.yml` esegue i test e, se passano, pubblica
la cartella `docs/` su GitHub Pages.
