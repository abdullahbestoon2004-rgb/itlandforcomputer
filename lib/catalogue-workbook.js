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
 */
import ExcelJS from 'exceljs';
import { groupByBrand } from './brands.js';

const IMG_PX = 64;
const ROW_HEIGHT = 50;

const COLUMNS = [
  { header: 'Image',       key: 'img',       width: 11 },
  { header: 'Product',     key: 'name',      width: 52 },
  { header: 'Code / SKU',  key: 'sku',       width: 20 },
  { header: 'Barcode',     key: 'barcode',   width: 18 },
  { header: 'Wholesale',   key: 'wholesale', width: 13, money: true },
  { header: 'Retail',      key: 'retail',    width: 13, money: true },
  { header: 'Stock',       key: 'stock',     width: 9 },
  { header: 'Status',      key: 'status',    width: 12 },
  { header: 'Category',    key: 'category',  width: 20 },
  { header: 'Description', key: 'desc',      width: 60 },
];

/** Thumbnail filename for a product image path, or null. */
export function thumbName(imgPath) {
  if (!imgPath) return null;
  const file = String(imgPath).split('/').pop();
  if (!/^[A-Za-z0-9._-]+\.webp$/i.test(file)) return null;
  return file.replace(/\.webp$/i, '.jpg');
}

/**
 * @param items      in-stock products, already filtered
 * @param loadThumb  async (thumbFileName) => Buffer | null
 * @param brands     optional brand names to include; omit or empty for all
 */
export async function buildCatalogueWorkbook(items, loadThumb, brands) {
  let groups = groupByBrand(items);
  if (brands && brands.length) {
    const wanted = new Set(brands.map(b => String(b).toLowerCase()));
    groups = groups.filter(g => wanted.has(g.brand.toLowerCase()));
  }
  const included = groups.reduce((n, g) => n + g.items.length, 0);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'iTLand Wholesale Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('Catalogue', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = COLUMNS.map(c => ({ key: c.key, width: c.width }));

  const stamp = new Date().toISOString().slice(0, 10);
  const scope = brands && brands.length ? `${groups.length} brands` : 'all brands';
  const title = ws.addRow([`iTLand wholesale catalogue — ${included} items in stock, ${scope} — ${stamp}`]);
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
      const row = ws.addRow({
        img: '',
        name: it.n || it.name || '',
        sku: it.s || it.sku || '',
        barcode: it.barcode || '',
        wholesale: it.p == null ? null : Number(it.p),
        retail: it.retail == null ? null : Number(it.retail),
        stock: Number(it.stock || 0),
        status: it.k ? 'In stock' : 'Out of stock',
        category: it.category || '',
        desc: it.d || it.description || '',
      });
      COLUMNS.forEach((c, i) => { if (c.money) row.getCell(i + 1).numFmt = '"$"#,##0.00'; });
      row.alignment = { vertical: 'middle' };

      const name = thumbName(it.img);
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

export const exportFilename = () =>
  `itland-catalogue-${new Date().toISOString().slice(0, 10)}.xlsx`;
