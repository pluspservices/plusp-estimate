/**
 * End-to-end check for design.html.
 * Run: NODE_PATH=/tmp/pptr/node_modules node design-browser.check.js
 * Does not call the live Apps Script or Web3Forms — those requests are stubbed.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const pricing = require('./design-pricing.js');

const ROOT = __dirname;
const SHOTS = '/tmp/design-shots';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function inTri(px, py, a, b, c) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function housePixel(x, y) {
  if (y < 430) {
    const t = y / 430;
    return [Math.round(126 - 36 * t), Math.round(176 - 28 * t), Math.round(220 - 24 * t)];
  }
  if (inTri(x, y, [60, 400], [480, 150], [900, 400])) {
    const band = (Math.floor(y / 7) % 2) * 14;
    return [96 + band, 54, 44];
  }
  if (x > 80 && x < 880 && y > 400 && y < 710) {
    if (x > 100 && x < 420 && y > 470 && y < 700) {
      const rail = (y > 545 && y < 558) || (y > 625 && y < 638);
      return rail ? [198, 202, 208] : [240, 242, 245];
    }
    if (x > 700 && x < 770 && y > 500 && y < 700) return [96, 62, 42];
    if (x > 500 && x < 600 && y > 480 && y < 580) {
      const frame = x < 510 || x > 590 || y < 490 || y > 570 || (x > 546 && x < 554) || (y > 526 && y < 534);
      return frame ? [236, 236, 240] : [150, 198, 214];
    }
    if (x > 230 && x < 330 && y > 430 && y < 520) return [176, 208, 220];
    return [214, 198, 172];
  }
  const dx = x - 1060;
  const dy = y - 560;
  if (dx * dx + dy * dy < 78 * 78 && y < 650) return [36, 118, 64];
  if (x > 1048 && x < 1074 && y > 560 && y < 730) return [98, 68, 44];
  const bx = (x - 200) / 58;
  const by = (y - 660) / 42;
  if (bx * bx + by * by < 1 && y > 600) return [42, 132, 68];
  if (y > 700) return [58, 122 + ((x * 3) % 12), 64];
  return [78, 146, 82];
}
function writeHouse(file) {
  const w = 1200;
  const h = 800;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = housePixel(x, y);
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

function startServer() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
    '.jpg': 'image/jpeg'
  };
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/design.html';
    const file = path.join(ROOT, path.normalize(urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('no');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function point(page, ix, iy) {
  await page.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(page);
  return page.evaluate((x, y) => window.__plusp.screenFromImage(x, y), ix, iy);
}

async function tap(page, ix, iy) {
  const p = await point(page, ix, iy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
}

async function drag(page, x1, y1, x2, y2) {
  const a = await point(page, x1, y1);
  const b = await point(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 15 });
  await page.mouse.up();
  await settle(page);
}

async function curve(page, pts) {
  await page.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'center', inline: 'nearest' }));
  await settle(page);
  const screen = [];
  for (const [x, y] of pts) {
    screen.push(await page.evaluate((ix, iy) => window.__plusp.screenFromImage(ix, iy), x, y));
  }
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for (let i = 1; i < screen.length; i++) {
    await page.mouse.move(screen[i].x, screen[i].y, { steps: 8 });
  }
  await page.mouse.up();
  await settle(page);
}

async function pickColor(page, label) {
  await page.evaluate((name) => {
    const btn = [...document.querySelectorAll('.swatch')].find((el) => el.textContent.indexOf(name) !== -1);
    if (!btn) throw new Error('missing color ' + name);
    btn.click();
  }, label);
}

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const customer = fs.readFileSync(path.join(ROOT, 'customer.html'), 'utf8');
  assert.match(customer, /href="design\.html"/);
  assert.match(customer, /action:\s*'lead'/);
  assert.match(customer, /prospects-api\.js/);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /plusp-estimate-v40/);
  assert.match(sw, /design\.html/);

  const house = path.join(SHOTS, 'sample-house.png');
  writeHouse(house);
  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const logs = [];
  page.on('pageerror', (err) => logs.push('PAGE ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') logs.push('CONSOLE ' + msg.text());
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(origin + '/design.html', { waitUntil: 'networkidle0' });
  const guideText = await page.$eval('#howItWorks', (el) => el.innerText);
  assert.match(guideText, /Take or upload a picture of the front of your house/);
  assert.match(guideText, /garage door or the front door/i);
  assert.match(guideText, /Pick a tool and a color/);
  assert.match(guideText, /Check the price range/);
  assert.match(guideText, /Enter your info and send/);
  const banner = await page.$eval('#stepBanner', (el) => el.innerText);
  assert.match(banner, /step 1 of 5/i);
  await (await page.$('#guideWrap')).screenshot({ path: path.join(SHOTS, 'design_instructions.png') });
  const input = await page.$('#photoLib');
  await input.uploadFile(house);
  await page.waitForFunction(() => window.__plusp && window.__plusp.ready);

  await page.click('#markScaleBtn');
  await drag(page, 100, 580, 420, 580);
  const scaleText = await page.$eval('#scaleState', (el) => el.textContent);
  assert.match(scaleText, /Scale set/);
  await page.click('#markScaleBtn');
  await drag(page, 100, 470, 420, 700);
  const tiltWarn = await page.$eval('#scaleWarn', (el) => el.classList.contains('hidden') ? '' : el.textContent);
  assert.match(tiltWarn, /straight across/i);
  const scaleStill = await page.$eval('#scaleState', (el) => el.textContent);
  assert.match(scaleStill, /Scale set/);

  await pickColor(page, 'Red/White');
  await page.click('#tool-roofline');
  await tap(page, 80, 400);
  await tap(page, 880, 400);
  await tap(page, 480, 170);
  await tap(page, 80, 400);
  await page.click('#doneBtn');

  await pickColor(page, 'Warm white');
  await page.click('#tool-window');
  await tap(page, 500, 480);
  await tap(page, 600, 480);
  await tap(page, 600, 580);
  await tap(page, 500, 580);
  await page.click('#doneBtn');

  await page.click('#tool-door');
  await tap(page, 700, 500);
  await tap(page, 770, 500);
  await tap(page, 770, 700);
  await tap(page, 700, 700);
  await page.click('#doneBtn');

  await page.click('#tool-garage');
  await tap(page, 100, 470);
  await tap(page, 420, 470);
  await tap(page, 420, 700);
  await tap(page, 100, 700);
  await page.click('#doneBtn');
  const garageShape = await page.evaluate(() => {
    const el = window.__plusp.elements.filter((item) => item.type === 'garage').pop();
    const run = (el.runs && el.runs[0]) || el.points;
    const ys = run.map((p) => p.y);
    const maxY = Math.max.apply(null, ys);
    const minY = Math.min.apply(null, ys);
    const ends = [run[0], run[run.length - 1]];
    const lit = window.PlusPPricing.polylineLength(run, false);
    const withBottom = window.PlusPPricing.polylineLength(run, true);
    return {
      openEndsLow: ends.every((p) => p.y >= maxY - 8),
      hasTop: minY < maxY - 40,
      lit: lit,
      withBottom: withBottom
    };
  });
  assert.equal(garageShape.openEndsLow, true, 'garage outline should end on the bottom corners');
  assert.equal(garageShape.hasTop, true);
  assert.ok(garageShape.withBottom > garageShape.lit + 40, 'bottom edge must be omitted from the garage length');
  await page.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'center' }));
  await settle(page);
  const windowShape = await page.evaluate(() => {
    const el = window.__plusp.elements.filter((item) => item.type === 'window').pop();
    const run = (el.runs && el.runs[0]) || el.points;
    return { lit: window.PlusPPricing.polylineLength(run, false) };
  });
  assert.ok(Math.abs(windowShape.lit - 400) < 8, 'window should be priced on the full perimeter');
  await (await page.$('#stage')).screenshot({ path: path.join(SHOTS, 'design_window_and_garage.png') });

  await page.click('#modeFreehand');
  await page.click('#tool-roofline');
  await curve(page, [[160, 760], [280, 700], [420, 680], [560, 710], [700, 760]]);
  const freehand = await page.evaluate(() => {
    const el = window.__plusp.elements.filter((item) => item.drawMode === 'freehand').pop();
    if (!el) return null;
    const pts = el.points;
    const a = pts[0];
    const b = pts[pts.length - 1];
    let off = 0;
    for (const p of pts) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const dist = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (dist > off) off = dist;
    }
    return { count: pts.length, off: off, mode: el.drawMode };
  });
  assert.ok(freehand, 'freehand stroke was not saved');
  assert.equal(freehand.mode, 'freehand');
  assert.ok(freehand.count >= 4, 'freehand path should keep the curve');
  assert.ok(freehand.off > 12, 'freehand path should not collapse to a straight line');
  await page.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'center' }));
  await settle(page);
  await (await page.$('#stage')).screenshot({ path: path.join(SHOTS, 'design_freehand_curve.png') });

  await page.click('#modeStraight');
  await pickColor(page, 'Warm white');
  await page.click('#tool-tree');
  await drag(page, 1060, 700, 1060, 500);

  await pickColor(page, 'Multicolor');
  await page.click('#tool-bush');
  await drag(page, 200, 660, 258, 702);

  const drawn = await page.evaluate(() => {
    const input = window.__plusp.pricingInput();
    const est = window.__plusp.estimate();
    const html = document.getElementById('estimateBody').innerHTML;
    return {
      input: input,
      low: est.low,
      high: est.high,
      ready: est.ready,
      types: window.__plusp.elements.map((el) => el.type),
      html: html,
      text: document.getElementById('estimateBody').innerText
    };
  });
  console.log('types', drawn.types.join(','));
  console.log('estimate', drawn.low, drawn.high);
  console.log(drawn.text);
  assert.deepEqual(drawn.types, ['roofline', 'window', 'door', 'garage', 'roofline', 'tree', 'bush']);
  const expected = pricing.buildEstimate(drawn.input);
  assert.equal(expected.ready, true);
  assert.equal(drawn.low, expected.low);
  assert.equal(drawn.high, expected.high);
  assert.ok(drawn.low > 0);
  assert.ok(drawn.high >= drawn.low);
  assert.equal(drawn.text.includes('$'), true);
  assert.doesNotMatch(drawn.html, /\bft\b|\bfeet\b|\bfoot\b|\binch|\bpx\b|footage/i);
  assert.match(drawn.html, /Roofline/);
  assert.match(drawn.html, /Windows/);
  assert.match(drawn.html, /Doors/);
  assert.match(drawn.html, /Trees/);
  assert.match(drawn.html, /Bushes/);
  assert.match(drawn.html, /Takedown/);
  assert.match(drawn.html, /Maintenance/);
  assert.match(drawn.html, /pending owner review and approval/);
  assert.match(drawn.html, /Included/);
  assert.doesNotMatch(drawn.text, /\.\d{2}/);
  const view = pricing.customerView(expected);
  assert.equal(view.lines.reduce((s, line) => s + line.amount, 0), expected.low);
  assert.match(drawn.text, new RegExp(view.range.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('–', '–')));

  await page.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'center' }));
  await settle(page);
  await (await page.$('#stage')).screenshot({ path: path.join(SHOTS, 'design_day_preview.png') });
  await (await page.$('#estimateCard')).screenshot({ path: path.join(SHOTS, 'design_estimate.png') });
  await page.click('#nightBtn');
  await page.waitForFunction(() => document.getElementById('nightBtn').getAttribute('aria-pressed') === 'true');
  await settle(page);
  await page.evaluate(() => document.getElementById('stage').scrollIntoView({ block: 'center' }));
  await settle(page);
  await (await page.$('#stage')).screenshot({ path: path.join(SHOTS, 'design_night_preview.png') });

  const beforeZoom = await page.evaluate(() => window.__plusp.view.scale);
  await page.click('#zoomIn');
  await settle(page);
  const afterZoom = await page.evaluate(() => window.__plusp.view.scale);
  assert.ok(afterZoom > beforeZoom, 'zoom in should increase scale');
  await page.click('#zoomFit');

  const beforeUndo = await page.evaluate(() => window.__plusp.elements.length);
  await page.click('#tool-roofline');
  await page.click('#modeStraight');
  await tap(page, 90, 360);
  await tap(page, 280, 360);
  await page.click('#doneBtn');
  const midUndo = await page.evaluate(() => window.__plusp.elements.length);
  assert.equal(midUndo, beforeUndo + 1);
  await page.click('#undoBtn');
  await settle(page);
  const afterUndo = await page.evaluate(() => window.__plusp.elements.length);
  assert.equal(afterUndo, beforeUndo);
  await page.click('#modeFreehand');
  await page.click('#tool-roofline');
  await curve(page, [[100, 640], [180, 600], [260, 640]]);
  const midFree = await page.evaluate(() => window.__plusp.elements.length);
  assert.equal(midFree, beforeUndo + 1);
  await page.click('#undoBtn');
  await settle(page);
  const afterFree = await page.evaluate(() => window.__plusp.elements.length);
  assert.equal(afterFree, beforeUndo);

  await page.evaluate(() => {
    window.__sent = null;
    window.__web3 = 0;
    window.__fetchMeta = null;
    const orig = window.fetch;
    window.fetch = function (url, opts) {
      const u = String(url);
      opts = opts || {};
      if (u.indexOf('script.google.com') !== -1) {
        window.__sent = JSON.parse(opts.body);
        window.__fetchMeta = { url: u, method: opts.method, contentType: opts.headers && opts.headers['Content-Type'], redirect: opts.redirect };
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          emailSent: true,
          prospectId: 'abc12345',
          folderUrl: 'https://drive.google.com/drive/folders/test-folder'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (u.indexOf('web3forms.com') !== -1) {
        window.__web3 += 1;
        return Promise.resolve(new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return orig.apply(this, arguments);
    };
    document.getElementById('firstName').value = 'Ada';
    document.getElementById('lastName').value = 'Tester';
    document.getElementById('phone').value = '(214) 555-0199';
    document.getElementById('street').value = '10 Oak Street';
    document.getElementById('city').value = 'Prosper';
    document.getElementById('state').value = 'TX';
    document.getElementById('zip').value = '75078';
    document.getElementById('email').value = 'ada.tester@example.com';
    document.getElementById('referredBy').value = 'NextDoor neighbor';
    document.getElementById('notes').value = 'Gate code 1234';
    document.getElementById('quoteForm').requestSubmit();
  });
  await page.waitForFunction(() => !document.getElementById('thanksCard').classList.contains('hidden') || (document.getElementById('formErr') && !document.getElementById('formErr').classList.contains('hidden')));
  const formErr = await page.$eval('#formErr', (el) => el.classList.contains('hidden') ? '' : el.textContent);
  if (formErr) throw new Error('form error: ' + formErr);
  const thanks = await page.$eval('#thanksLead', (el) => el.textContent.trim());
  const thanksCard = await page.$eval('#thanksCard', (el) => el.innerText);
  assert.equal(thanks, '+P Holiday Lighting will review your design and text you a final quote ASAP.');
  assert.match(thanksCard, /\(214\) 995-3002/);
  await (await page.$('#thanksCard')).screenshot({ path: path.join(SHOTS, 'design_confirmation.png') });

  const captured = await page.evaluate(() => window.__sent);
  const web3 = await page.evaluate(() => window.__web3);
  const fetchMeta = await page.evaluate(() => window.__fetchMeta);
  assert.equal(fetchMeta.method, 'POST');
  assert.match(fetchMeta.contentType, /text\/plain/);
  assert.equal(fetchMeta.redirect, 'follow');
  assert.ok(captured, 'Apps Script payload was not captured');
  assert.equal(captured.action, 'lead');
  assert.equal(captured.source, 'design form');
  assert.equal(captured.first_name, 'Ada');
  assert.equal(captured.last_name, 'Tester');
  assert.equal(captured.phone, '(214) 555-0199');
  assert.equal(captured.city, 'Prosper');
  assert.equal(captured.state, 'TX');
  assert.equal(captured.email, 'ada.tester@example.com');
  assert.match(captured.notes, /NextDoor neighbor/);
  assert.match(captured.notes, /Gate code 1234/);
  assert.equal(captured.estimate_low, expected.low);
  assert.equal(captured.estimate_high, expected.high);
  assert.equal(captured.photos.length, 2);
  assert.equal(captured.photos[0].name, 'original.jpg');
  assert.equal(captured.photos[1].name, 'design-preview.jpg');
  assert.match(captured.photos[0].data, /^data:image\/jpeg/);
  assert.match(captured.design_image.data, /^data:image\/jpeg/);
  assert.equal(captured.design_image.name, 'design-preview.jpg');
  assert.match(captured.owner_estimate, /Ada Tester/);
  assert.match(captured.owner_estimate, /\bft\b/);
  assert.match(captured.owner_estimate, /Nothing was sent to the customer/);
  assert.match(captured.owner_estimate, /7\.5% pad/);
  assert.equal(captured.to, undefined);
  assert.equal(web3, 0, 'Web3Forms should not be called when Apps Script reports emailSent');
  assert.equal(logs.filter((line) => line.startsWith('PAGE')).join('\n'), '');

  await page.goto(origin + '/customer.html', { waitUntil: 'domcontentloaded' });
  const link = await page.$eval('a[href="design.html"]', (a) => a.textContent);
  assert.match(link, /Design your lights/);

  async function stubCustomer(scriptResult, scriptReject) {
    await page.goto(origin + '/customer.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate((result, reject) => {
      window.__sentUrl = '';
      window.__mails = [];
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        const u = String(url);
        opts = opts || {};
        if (u.indexOf('script.google.com') !== -1) {
          window.__sentUrl = u;
          if (reject) return Promise.reject(new Error('network down'));
          return Promise.resolve(new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (u.indexOf('web3forms.com') !== -1) {
          let payload = {};
          try { payload = JSON.parse(opts.body); } catch (err) {}
          window.__mails.push(payload);
          return Promise.resolve(new Response('{"success":true}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        return orig.apply(this, arguments);
      };
    }, scriptResult, !!scriptReject);
  }
  async function fillCustomer() {
    await page.evaluate(() => {
      document.getElementById('firstName').value = 'Sam';
      document.getElementById('lastName').value = 'Sample';
      document.getElementById('phone').value = '(555) 010-0199';
      document.getElementById('street').value = '100 Example Lane';
      document.getElementById('city').value = 'Prosper';
      document.getElementById('zip').value = '75078';
      document.getElementById('email').value = 'sam.sample@example.com';
      document.getElementById('notes').value = 'Gate code 1234';
      document.getElementById('quoteForm').requestSubmit();
    });
    await page.waitForFunction(() => !document.getElementById('thanksCard').classList.contains('hidden'));
  }

  await stubCustomer({ ok: true, photoCount: 1, folderUrl: 'https://drive.google.com/drive/folders/abc' });
  await fillCustomer();
  let mail = await page.evaluate(() => window.__mails[0]);
  let thanksLead = await page.$eval('#thanksLead', (el) => el.textContent);
  let quoteErr = await page.$eval('#formErr', (el) => el.classList.contains('hidden') ? '' : el.textContent);
  assert.equal(quoteErr, '');
  assert.match(thanksLead, /quote request was sent/);
  assert.equal(mail.subject.indexOf('SAVE FAILED'), -1);
  assert.match(mail.message, /Photos saved: 1/);
  assert.match(mail.message, /100 Example Lane/);
  assert.match(mail.message, /Gate code 1234/);
  const sentUrl = await page.evaluate(() => window.__sentUrl);
  assert.match(sentUrl, /AKfycbyw52oCbvejmA3aIdUtRtY8NcnPC0ceNXtvmW2TaKsNQJUpg8SEmF625IcNkho4kC14/);

  await stubCustomer({ ok: true, photoCount: 0, photosFailed: true, error: 'Photos were attached but none saved to Drive.' });
  const photoInput = await page.$('#photos');
  await photoInput.uploadFile(house);
  await page.waitForFunction(() => document.querySelectorAll('#preview img').length > 0);
  await fillCustomer();
  mail = await page.evaluate(() => window.__mails[0]);
  thanksLead = await page.$eval('#thanksLead', (el) => el.textContent);
  const thanksExtra = await page.$eval('#thanksExtra', (el) => el.textContent);
  quoteErr = await page.$eval('#formErr', (el) => el.classList.contains('hidden') ? '' : el.textContent);
  assert.equal(quoteErr, '');
  assert.match(thanksLead, /photos did not save/i);
  assert.match(thanksExtra, /995-3002/);
  assert.equal(mail.subject.indexOf('SAVE FAILED'), -1);
  assert.match(mail.message, /Photos saved: 0/);

  await stubCustomer({ ok: false, error: 'Customers tab is missing', photoCount: 0 });
  await fillCustomer();
  mail = await page.evaluate(() => window.__mails[0]);
  thanksLead = await page.$eval('#thanksLead', (el) => el.textContent);
  const formHidden = await page.$eval('#formCard', (el) => el.classList.contains('hidden'));
  quoteErr = await page.$eval('#formErr', (el) => el.classList.contains('hidden') ? '' : el.textContent);
  assert.equal(formHidden, true);
  assert.equal(quoteErr, '');
  assert.match(thanksLead, /we got your request/i);
  assert.match(mail.subject, /^SAVE FAILED/);
  assert.match(mail.message, /555\) 010-0199/);
  assert.match(mail.message, /100 Example Lane/);
  assert.match(mail.message, /sam\.sample@example.com/);
  assert.match(mail.message, /Gate code 1234/);
  assert.match(mail.message, /Customers tab is missing/);

  await stubCustomer(null, true);
  await fillCustomer();
  mail = await page.evaluate(() => window.__mails[0]);
  thanksLead = await page.$eval('#thanksLead', (el) => el.textContent);
  assert.match(thanksLead, /we got your request/i);
  assert.match(mail.subject, /^SAVE FAILED/);
  assert.match(mail.message, /network down/);

  await browser.close();
  server.close();
  console.log('browser check passed');
  console.log('shots', SHOTS);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
