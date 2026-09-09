/**
 * Catalogue workbook
 * ==================
 * Builds the Excel export: one sheet, each brand introduced by its own heading
 * row, its in-stock products listed underneath.
 *
 * Shared by the Node server and the Vercel function so the two produce an
 * identical file. They differ only in where the pictures come from, which is
 * why `loadThumb` is injected: the server reads
 * public/assets/xlsx-thumbs/ from disk, while the serverless function fetches
 * the same files over HTTP from its own deployment.
 *
 * Those thumbnails are pre-built (scripts/build-xlsx-thumbs.mjs) rather than
 * converted here. Excel will not reliably render WebP and every product image
 * is WebP, and the `dwebp` that converts them does not exist in a serverless
 * runtime — which is why the deployed export could not have shown pictures.
 *
 * The rows, columns and brand grouping come from catalogue-rows.js, shared
 * with the CSV and PDF exports.
 */
import ExcelJS from 'exceljs';
import { COLUMNS, selectGroups, productRow, thumbName, exportStamp } from './catalogue-rows.js';

export { thumbName, exportFilename } from './catalogue-rows.js';

const IMG_PX = 64;
const ROW_HEIGHT = 50;

/**
 * @param items      in-stock products, already filtered
 * @param loadThumb  async (thumbFileName) => Buffer | null
 * @param brands     optional brand names to include; omit or empty for all
 */
export async function buildCatalogueWorkbook(items, loadThumb, brands) {
  const { groups, included, scope } = selectGroups(items, brands);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'iTLand Wholesale Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('Catalogue', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

  const title = ws.addRow([`iTLand wholesale catalogue — ${included} items in stock, ${scope} — ${exportStamp()}`]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, COLUMNS.length);
  ws.addRow([]);

  for (const group of groups) {
    const head = ws.addRow([`${group.brand}  (${group.items.length})`]);
    head.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17130E' } };
    head.height = 22;
    ws.mergeCells(head.number, 1, head.number, COLUMNS.length);

    const cols = ws.addRow(COLUMNS.map(c => c.header));
    cols.font = { bold: true };
    cols.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EADC' } };

    for (const it of group.items) {
      const data = productRow(it);
      const row = ws.addRow({ ...data, img: '' });
      COLUMNS.forEach((c, i) => { if (c.money) row.getCell(i + 1).numFmt = '"$"#,##0.00'; });
      row.alignment = { vertical: 'middle' };

      const name = thumbName(data.img);
      if (!name) continue;
      // A picture that cannot be loaded must never fail the whole download.
      let buf = null;
      try { buf = await loadThumb(name); } catch { buf = null; }
      if (!buf) continue;
      row.height = ROW_HEIGHT;
      const id = wb.addImage({ buffer: buf, extension: 'jpeg' });
      ws.addImage(id, {
        tl: { col: 0.15, row: row.number - 1 + 0.1 },
        ext: { width: IMG_PX, height: IMG_PX },
        editAs: 'oneCell',
      });
    }
    ws.addRow([]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
