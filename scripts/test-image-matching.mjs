/**
 * Image matching test suite
 * =========================
 *   node scripts/test-image-matching.mjs
 *
 * Run this after changing lib/product-matching.js or adding product images.
 *
 * The hard part of this matcher is not matching — it is *declining to match*.
 * There are ~195 images and far more SKUs, so most products have no correct art
 * and the right answer is null. Returning a plausible-looking wrong image is
 * worse than showing nothing: a customer sees a $150 gaming mouse on a $15
 * office mouse listing and the price looks wrong. Suite 1 is the one that
 * matters most.
 */
import { LOCAL_IMAGES } from '../product-image-manifest.js';
import { findProductImage } from '../lib/product-matching.js';

const match = (name) => {
  const got = findProductImage({ id: 'x', name, sku: '', description: '' }, { images: LOCAL_IMAGES });
  return got ? got.split('/').pop() : null;
};

let failures = 0;
const report = (suite, bad, total) => {
  const ok = total - bad.length;
  console.log(`${bad.length ? 'FAIL' : 'pass'}  ${suite}: ${ok}/${total}`);
  for (const line of bad) console.log(`        ${line}`);
  failures += bad.length;
};

// ── 1. Products with no correct art must return NOTHING ──────────────────────
const mustBeNull = [
  'Logitech C270i IPTV HD Webcam',
  'Jabra Evolve2 75 Wireless Headset',
  'Jabra Speak 750 UC Speakerphone',
  'Poly Voyager 5200 UC Bluetooth Headset',
  'JBL Tune 520BT Wireless Headphones',
  'JBL Charge 5 Portable Speaker',
  'Anker PowerCore 10000 Power Bank',
  'Anker 737 USB-C Charger 120W',
  'Samsung T9 Portable SSD 2TB',
  'SanDisk Ultra Dual Drive 128GB',
  'Dell WD22TB4 Thunderbolt Dock',
  'Razer Basilisk V3 Gaming Mouse',
  'UGREEN Nexode 65W GaN Charger',
  'Onten OTN-7595 HDMI Splitter',
  'Elgato Wave 3 USB Microphone',
  'Lention CB-C36 USB C Hub',
];
report('no-art products return null', mustBeNull
  .map(n => [n, match(n)]).filter(([, g]) => g)
  .map(([n, g]) => `"${n}" wrongly matched ${g}`), mustBeNull.length);

// ── 2. Confusable model families resolve to the right member ────────────────
const confusable = [
  ['Logitech M170 Wireless Mouse Black',               'Logitech_M170.webp'],
  ['LOGITECH M171 WIRELESS MOUSE BLUE',                'Logitech_M171.webp'],
  ['Logitech M185 Wireless Mouse Swift Grey',          'Logitech_M185.webp'],
  ['Logitech MX Master 3S Graphite 910-006559',        'Logitech_MX_Master_3S.webp'],
  ['Logitech MX Master 4',                             'Logitech_MX_Master_4.webp'],
  ['Logitech MX Brio 4K Webcam',                       'Logitech_MX_Brio_4K.webp'],
  ['Logitech MX Brio 705 for Business',                'Logitech_MX_Brio_705.webp'],
  ['Logitech Brio 500 Full HD Webcam Graphite',        'Logitech_Brio_500.webp'],
  ['Logitech Brio 300 Full HD Webcam',                 'Logitech_Brio_300.webp'],
  ['Logitech Brio 4K Pro Webcam',                      'Logitech_Brio_4K.webp'],
  ['Logitech C920 PRO HD Webcam',                      'Logitech_C920_PRO.webp'],
  ['Logitech C922 Pro Stream Webcam',                  'Logitech_C922.webp'],
  ['Logitech C925e Business Webcam',                   'Logitech_C925e.webp'],
  ['Logitech G Pro X Superlight Wireless Mouse',       'Logitech_G_Pro_X_Superlight.webp'],
  ['Logitech G Pro X Superlight 2 Wireless',           'Logitech_G_Pro_X_Superlight_2.webp'],
  ['Logitech G Pro X Superlight 2 DEX Magenta',        'Logitech_G_Pro_X_Superlight_2_DEX.webp'],
  ['Jabra Speak 510 Speakerphone',                     'Jabra_Speak_510.webp'],
  ['Jabra Speak 510 UC Speakerphone MS',               'Jabra_Speak_510_UC.webp'],
  ['Jabra Evolve2 65 Stereo USB-A MS',                 'Jabra_Evolve2_65.webp'],
  ['Jabra Evolve 40 Stereo UC',                        'Jabra_Evolve_40.webp'],
  ['Poly Sync 20 Speakerphone',                        'Poly_Sync_20.webp'],
  ['Poly Sync 20+ Speakerphone with BT600',            'Poly_Sync_20_Plus.webp'],
  ['Logitech Z200 Multimedia Speakers',                'Logitech_Z200.webp'],
  ['Logitech Z207 Bluetooth Speakers',                 'Logitech_Z207.webp'],
  ['Logitech K380 Multi-Device Bluetooth Keyboard',    'Logitech_K380.webp'],
  ['Logitech K480 Bluetooth Multi-Device Keyboard',    'Logitech_K480.webp'],
  ['Logitech MK270 Wireless Combo Keyboard and Mouse', 'Logitech_MK270.webp'],
  ['Logitech MK470 Slim Wireless Combo',               'Logitech_MK470.webp'],
  ['Logitech G435 LIGHTSPEED Wireless Gaming Headset', 'Logitech_G435.webp'],
  ['Logitech G733 LIGHTSPEED Wireless RGB Headset',    'Logitech_G733.webp'],
  ['Onten OTN-9118 USB-C Hub',                         'Onten_OTN-9118.webp'],
  ['Onten OTN-9598 Docking Station',                   'Onten_OTN-9598.webp'],
  ['Logitech Group Conference System',                 'Logitech_Group_Conference_System.webp'],
  ['Logitech Group 10M Extended Cable',                'Logitech_Group_10M_Cable.webp'],
  ['Logitech Group 15M Extended Cable',                'Logitech_Group_15M_Cable.webp'],
  // Official art fetched from logitech.com via scripts/fetch-product-images.mjs.
  ['Logitech M240 Silent Bluetooth Mouse',             'Logitech_M240.webp'],
  ['Logitech MK295 Silent Wireless Combo',             'Logitech_MK295.webp'],
  ['Logitech H390 USB Headset',                        'Logitech_H390.webp'],
  ['Logitech K400 Plus Wireless Touch Keyboard',       'Logitech_K400_Plus_Touch.webp'],
  // Same product, different marketing name / colourway — should still match.
  ['Logitech Z150 Stereo Speakers Midnight Black',     'Logitech_Z150.webp'],
  ['Logitech M350s Pebble Mouse 2',                    'Logitech_Pebble_Mouse_2.webp'],
];
report('confusable models', confusable
  .map(([n, e]) => [n, e, match(n)]).filter(([, e, g]) => g !== e)
  .map(([n, e, g]) => `"${n}" want ${e} got ${g}`), confusable.length);

// ── 3. Every image is found from its own name, plus common name noise ────────
const noise = [
  n => n, n => n.toUpperCase(), n => `${n} Black`, n => `${n} Wireless`,
  n => `${n} - Office Price 45 $`, n => `${n} 097855174574`,
  n => `${n} for Business, 1 Year Warranty`,
];
const sweepBad = [];
let sweepTotal = 0;
for (const f of LOCAL_IMAGES) {
  const base = f.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  for (const fn of noise) {
    sweepTotal++;
    const name = fn(base);
    const got = match(name);
    if (got !== f && sweepBad.length < 15) sweepBad.push(`"${name}" want ${f} got ${got}`);
    else if (got !== f) sweepBad.push('');
  }
}
report('self-match under name noise', sweepBad.filter(Boolean).length ? sweepBad : [], sweepTotal);

console.log(failures === 0 ? '\nAll suites passed.' : `\n${failures} failing case(s).`);
process.exit(failures === 0 ? 0 : 1);
