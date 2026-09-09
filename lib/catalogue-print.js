/**
 * Catalogue print page (the PDF export)
 * =====================================
 * A standalone, print-styled page of the in-stock catalogue. The customer
 * saves it as PDF from the browser's own print dialog, which the page opens
 * for them once the pictures have loaded.
 *
 * Rendering to PDF on the server was the alternative and a worse trade. It
 * needs a PDF library and, to look like this, the fonts and the product images
 * decoded in the function — several hundred of them for the whole catalogue,
 * against a serverless memory and time budget. The browser already has a PDF
 * writer, the fonts and a WebP decoder, so the page is sent as HTML and it
 * does the work.
 *
 * Being a whole document rather than part of the app, the styles are inline
 * and the image paths stay site-relative: it is served from the same origin as
 * /assets.
 */
import { selectGroups, productRow, exportStamp } from './catalogue-rows.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * True when the description only restates the product name.
 *
 * Tested both ways round: many descriptions arrive truncated, so the one that
 * repeats the name is often the shorter of the two.
 */
function isEcho(desc, name) {
  const d = squash(desc);
  const n = squash(name);
  return !d || !n || d === n || d.startsWith(n) || n.startsWith(d);
}

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #F6F1E6; color: #17130E;
         font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { max-width: 200mm; margin: 0 auto; padding: 10mm 8mm 16mm; background: #fff; }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px;
         flex-wrap: wrap; padding: 12px 18px; background: #17130E; color: #fff; }
  .bar p { margin: 0; flex: 1; font-size: 13px; opacity: .82; }
  .bar button { padding: 9px 16px; font: inherit; font-weight: 700; color: #17130E;
                background: #fff; border: none; border-radius: 10px; cursor: pointer; }
  .masthead { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
              padding-bottom: 10px; margin-bottom: 14px; border-bottom: 3px solid #17130E; }
  .masthead img { height: 30px; width: auto; }
  .masthead h1 { margin: 6px 0 2px; font-size: 19px; letter-spacing: -.2px; }
  .masthead .meta { font-size: 11.5px; color: #6E6558; text-align: right; }
  h2 { margin: 16px 0 0; padding: 6px 10px; font-size: 13px; color: #fff; background: #17130E;
       border-radius: 5px 5px 0 0; break-after: avoid; page-break-after: avoid; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { padding: 6px 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px;
       text-align: left; color: #4A4236; background: #F1EADC; border-bottom: 1.5px solid #E0D5BE; }
  td { padding: 7px 8px; vertical-align: middle; border-bottom: 1px solid #EDE6D7; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* Fixed widths, so the product name gets the room instead of losing it to
     whichever column happens to hold the longest string. */
  .pic { width: 22mm; }
  .c-code { width: 40mm; }
  .c-money { width: 20mm; }
  .c-stock { width: 15mm; }
  .pic img { display: block; width: 100%; height: 16mm; object-fit: contain; }
  .pic .none { height: 16mm; background: #F6F1E6; border-radius: 4px; }
  .name { font-weight: 600; }
  .desc { margin-top: 2px; font-size: 10.5px; color: #6E6558;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .code { font-size: 10.5px; overflow-wrap: anywhere; }
  .code small { display: block; color: #8A8272; font-size: 10px; }
  .whole { font-weight: 700; }
  footer { margin-top: 18px; padding-top: 8px; font-size: 10.5px; color: #8A8272;
           border-top: 1px solid #E0D5BE; }
  @page { size: A4; margin: 12mm 10mm; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { max-width: none; margin: 0; padding: 0; }
    h2 { border-radius: 0; }
  }
`;

/**
 * @param items   in-stock products, already filtered
 * @param brands  optional brand names to include; omit or empty for all
 * @returns a complete HTML document
 */
export function buildCataloguePrintPage(items, brands) {
  const { groups, included, scope } = selectGroups(items, brands);
  const stamp = exportStamp();

  const sections = groups.map(group => {
    const rows = group.items.map(it => {
      const row = productRow(it);
      const pic = row.img
        ? `<img src="${esc(row.img)}" alt="" loading="eager">`
        : '<div class="none"></div>';
      // Most descriptions open with the product name verbatim, which would
      // print the same sentence twice and double the length of the catalogue.
      const blurb = isEcho(row.desc, row.name) ? '' : row.desc;
      return `<tr>
        <td class="pic">${pic}</td>
        <td>
          <div class="name">${esc(row.name)}</div>
          ${blurb ? `<div class="desc">${esc(blurb)}</div>` : ''}
        </td>
        <td class="code">${esc(row.sku)}${row.barcode && row.barcode !== row.sku ? `<small>${esc(row.barcode)}</small>` : ''}</td>
        <td class="num whole">${money(row.wholesale)}</td>
        <td class="num">${money(row.retail)}</td>
        <td class="num">${row.stock}</td>
      </tr>`;
    }).join('');

    return `<section>
      <h2>${esc(group.brand)} &nbsp;·&nbsp; ${group.items.length} items</h2>
      <table>
        <colgroup>
          <col class="pic"><col><col class="c-code">
          <col class="c-money"><col class="c-money"><col class="c-stock">
        </colgroup>
        <thead><tr>
          <th>Image</th><th>Product</th><th>Code / SKU</th>
          <th class="num">Wholesale</th><th class="num">Retail</th><th class="num">Stock</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iTLand wholesale catalogue — ${stamp}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="bar">
  <p>Your print dialog should open on its own. Choose <b>Save as PDF</b> as the destination.</p>
  <button type="button" onclick="window.print()">Save as PDF</button>
</div>
<div class="sheet">
  <div class="masthead">
    <div>
      <img src="/assets/itland-logo.png" alt="iTLand">
      <h1>Wholesale catalogue</h1>
    </div>
    <div class="meta">${included} items in stock<br>${esc(scope)}<br>${stamp}</div>
  </div>
  ${sections || '<p>No in-stock products matched the brands you selected.</p>'}
  <footer>iTLand wholesale price list · Prices in USD · Stock levels as of ${stamp} and subject to change.</footer>
</div>
<script>
  // Print once the pictures are decoded, so none of them come out blank.
  addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });
</script>
</body>
</html>`;
}
