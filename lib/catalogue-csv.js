/**
 * Catalogue CSV (the Google Sheets export)
 * ========================================
 * A flat table of the in-stock catalogue for Google Sheets, Numbers, and any
 * system that imports CSV.
 *
 * Two things differ from the Excel workbook on purpose:
 *
 *  - Brand is a column, not a heading row. The workbook's brand banners would
 *    become stray rows here, and a column is what lets the reader sort and
 *    filter by brand once the sheet is open.
 *  - The picture is an =IMAGE() formula rather than an embedded object.
 *    Google Sheets drops images anchored over cells when it imports an .xlsx,
 *    so the workbook arrives with an empty first column; a formula survives
 *    the import and renders the photo in the cell. Sheets evaluates formulas
 *    on CSV import, which is what makes this work.
 *
 * The plain URL is carried in its own last column too, for importers that want
 * the address rather than the picture.
 *
 * Output is UTF-8 with a byte order mark. Without it Excel reads the file as
 * the local 8-bit codepage and mangles every non-Latin product name.
 */
import { selectGroups, productRow, sheetImageUrl } from './catalogue-rows.js';

const HEADERS = [
  'Brand', 'Image', 'Product', 'Code / SKU', 'Barcode', 'Wholesale', 'Retail',
  'Stock', 'Status', 'Category', 'Description', 'Image URL',
];

/** RFC 4180 field: quote when the value could otherwise break the row. */
function cell(value) {
  if (value == null) return '';
  const s = String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * @param items   in-stock products, already filtered
 * @param brands  optional brand names to include; omit or empty for all
 * @param origin  absolute site origin, needed because =IMAGE() cannot follow
 *                a site-relative path
 * @returns CSV text, byte-order-marked, CRLF terminated
 */
export function buildCatalogueCsv(items, brands, origin) {
  const { groups } = selectGroups(items, brands);
  const lines = [HEADERS.map(cell).join(',')];

  for (const group of groups) {
    for (const it of group.items) {
      const row = productRow(it);
      const url = sheetImageUrl(row.img, origin);
      lines.push([
        group.brand,
        url ? `=IMAGE("${url}")` : '',
        row.name,
        row.sku,
        row.barcode,
        row.wholesale == null ? '' : row.wholesale,
        row.retail == null ? '' : row.retail,
        row.stock,
        row.status,
        row.category,
        row.desc,
        url || '',
      ].map(cell).join(','));
    }
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}
