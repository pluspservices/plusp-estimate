const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('./design-pricing.js');

const P = api.PRICING;

test('config matches the published rates', () => {
  assert.equal(P.footagePad, 0.075);
  assert.equal(P.rooflinePerFt, 5);
  assert.equal(P.gluePerFt, 6);
  assert.equal(P.ballPrice, 25);
  assert.equal(P.ballFeet, 25);
  assert.equal(P.treeMaxHeightFt, 10);
  assert.equal(P.bushSpacingIn, 4);
  assert.equal(P.storagePerTubPerYear, 25);
  assert.equal(P.references.garage2.feet, 16);
  assert.equal(P.references.garage1.feet, 8);
  assert.equal(P.references.door.feet, 3);
});

test('bush spiral formula is circumference × height × 12 / 4', () => {
  assert.equal(api.bushLightsFt(6, 3), 54);
  assert.equal(api.bushLightsFt(6, 3), 6 * 3 * 12 / 4);
  const priced = api.priceLights(54);
  assert.equal(priced.paddedFt, 54 * 1.075);
  assert.equal(priced.balls, 3);
  assert.equal(priced.price, 75);
});

test('tree trunks cap at 10 ft and price per 25 ft ball after the pad', () => {
  // circumference 2 ft, drawn height 12 ft → priced at 10 ft, 1.5 in spacing
  const lights = api.treeLightsFt(2, 12);
  assert.equal(lights, 2 * 10 * 12 / 1.5);
  assert.equal(lights, 160);
  const priced = api.priceLights(lights);
  assert.equal(priced.paddedFt, 172);
  assert.equal(priced.balls, Math.ceil(172 / 25));
  assert.equal(priced.balls, 7);
  assert.equal(priced.price, 175);

  const shorter = api.priceLights(api.treeLightsFt(2, 8));
  assert.equal(api.treeLightsFt(2, 8), 128);
  assert.equal(shorter.balls, 6);
  assert.equal(shorter.price, 150);
});

test('roofline and glued wall work use the 7.5% pad and whole dollars', () => {
  const roof = api.buildEstimate({
    pxPerFt: 10,
    elements: [{ type: 'roofline', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], closed: false }]
  });
  // 100 ft × 1.075 × $5 = 537.5 → $538
  assert.equal(roof.categories[0].price, 538);
  assert.equal(roof.low, 538);
  assert.equal(roof.high, Math.round(538 * 1.15));

  const odd = api.buildEstimate({
    pxPerFt: 10,
    elements: [{ type: 'roofline', points: [{ x: 0, y: 0 }, { x: 102, y: 0 }] }]
  });
  // 10.2 ft × 1.075 × $5 = 54.825 → $55
  assert.equal(odd.low, 55);

  const glue = api.buildEstimate({
    pxPerFt: 10,
    elements: [{ type: 'window', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }]
  });
  // 10 ft × 1.075 × $6 = 64.5 → $65
  assert.equal(glue.low, 65);

  const door = api.buildEstimate({
    pxPerFt: 10,
    elements: [{ type: 'door', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  });
  assert.equal(door.low, 65);
  const garage = api.buildEstimate({
    pxPerFt: 10,
    elements: [{ type: 'garage', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  });
  assert.equal(garage.low, 65);
  const arch = api.buildEstimate({
    pxPerFt: 10,
    elements: [{ type: 'archway', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  });
  assert.equal(arch.low, 65);
});

test('linear footage is summed before rounding', () => {
  const est = api.buildEstimate({
    pxPerFt: 10,
    elements: [
      { type: 'roofline', points: [{ x: 0, y: 0 }, { x: 101, y: 0 }] },
      { type: 'roofline', points: [{ x: 0, y: 0 }, { x: 101, y: 0 }] }
    ]
  });
  // 20.2 ft × 1.075 × $5 = 108.575 → $109 (not 54 + 54)
  assert.equal(est.categories.length, 1);
  assert.equal(est.low, 109);
});

test('windows use the full perimeter; doors and garages leave the bottom dark', () => {
  const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  // 100 px by 50 px at 10 px/ft is 10 ft by 5 ft.
  const windowRuns = api.litRuns(rect, 'window');
  assert.equal(api.litLengthPx(rect, 'window'), 300);
  assert.equal(api.polylineLength(api.litRuns(windowRuns[0], 'window')[0], false), 300);
  const windowEst = api.buildEstimate({ pxPerFt: 10, elements: [{ type: 'window', points: rect }] });
  assert.equal(windowEst.categories[0].lengthFt, 30);
  // 30 ft × 1.075 × $6 = 193.5 → $194
  assert.equal(windowEst.low, 194);
  assert.match(api.ownerReport(windowEst), /full outline/);
  assert.doesNotMatch(api.ownerReport(windowEst), /bottom left dark/);

  for (const type of ['door', 'garage']) {
    const runs = api.litRuns(rect, type);
    assert.equal(runs.length, 1);
    assert.equal(api.litLengthPx(rect, type), 200);
    const again = api.litRuns(runs[0], type);
    assert.equal(api.polylineLength(again[0], false), 200);
    const est = api.buildEstimate({ pxPerFt: 10, elements: [{ type, closed: true, points: rect }] });
    assert.equal(est.categories[0].lengthFt, 20);
    // 20 ft × 1.075 × $6 = 129
    assert.equal(est.low, 129);
    assert.match(api.ownerReport(est), /bottom left dark/);
  }

  const arch = [{ x: 0, y: 50 }, { x: 25, y: 10 }, { x: 50, y: 0 }, { x: 75, y: 10 }, { x: 100, y: 50 }];
  const archLen = api.litLengthPx(arch, 'archway');
  const withSill = api.polylineLength(arch, true);
  assert.ok(withSill > archLen + 50, 'arch price must drop the bottom chord');
  assert.ok(Math.abs(archLen - (
    Math.hypot(25, 40) + Math.hypot(25, 10) + Math.hypot(25, 10) + Math.hypot(25, 40)
  )) < 0.01);

  // An open U stays sides + top for a garage. A window closes that U into 30 ft.
  const u = [{ x: 0, y: 50 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  assert.equal(api.litLengthPx(u, 'garage'), 200);
  assert.equal(api.litLengthPx(u, 'door'), 200);
  assert.equal(api.litLengthPx(u, 'window'), 300);

  // A single top line stays intact.
  const top = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.equal(api.litLengthPx(top, 'garage'), 100);

  // Rooflines keep every segment, including a closed shape.
  const roof = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }];
  assert.equal(api.litLengthPx(roof, 'roofline'), api.polylineLength(roof, false));
  assert.equal(api.litRuns(roof, 'roofline').length, 1);
});

test('bushes and trees from pixel geometry, plus storage and included work', () => {
  const pxPerFt = 10;
  // circumference 6 ft → width = 6/π ft → rx = 30/π
  const rx = 30 / Math.PI;
  const est = api.buildEstimate({
    pxPerFt: pxPerFt,
    tubs: 2,
    elements: [
      { type: 'bush', color: 'green', rx: rx, ry: 15 },
      {
        type: 'tree',
        color: 'warm',
        heightPx: 120,
        diameterPx: (2 / Math.PI) * pxPerFt,
        diameterMode: 'auto'
      }
    ]
  });
  const bush = est.categories.find((c) => c.id === 'bush');
  const tree = est.categories.find((c) => c.id === 'tree');
  const storage = est.categories.find((c) => c.id === 'storage');
  assert.equal(bush.price, 75);
  assert.ok(Math.abs(bush.items[0].lightsFt - 54) < 1e-9);
  assert.equal(tree.price, 175);
  assert.ok(tree.items[0].heightFt > 10);
  assert.equal(tree.items[0].pricedHeightFt, 10);
  assert.equal(storage.price, 50);
  assert.equal(est.low, 75 + 175 + 50);
  assert.equal(est.high, Math.round(est.low * 1.15));
  assert.deepEqual(est.included.map((l) => l.amount), [0, 0]);
});

test('customer view is prices only and owner report keeps footage', () => {
  const est = api.buildEstimate({
    pxPerFt: 10,
    tubs: 1,
    elements: [
      { type: 'roofline', color: 'red-white', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
      { type: 'window', color: 'warm', closed: false, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }
    ]
  });
  const view = api.customerView(est);
  const blob = JSON.stringify(view);
  assert.match(blob, /Roofline/);
  assert.match(blob, /Windows/);
  assert.match(blob, /Storage/);
  assert.doesNotMatch(blob, /\bft\b|\bfeet\b|\bfoot\b|\binch|\bpx\b|footage|measured/i);
  assert.equal(view.lines.reduce((s, l) => s + l.amount, 0), est.low);
  assert.equal(view.low, 538 + Math.round(40 * 1.075 * 6) + 25);
  assert.deepEqual(view.included, ['Takedown', 'Maintenance']);

  const report = api.ownerReport(est, {
    name: 'Jane Doe',
    phone: '(214) 555-0100',
    email: '',
    address: '10 Oak St, Prosper, TX 75078',
    notes: 'Gate 123',
    referredBy: 'NextDoor',
    scale: { label: '2-car garage door', feet: 16, px: 320, pxPerFt: 20 }
  });
  assert.match(report, /Jane Doe/);
  assert.match(report, /NextDoor/);
  assert.match(report, /100 ft/);
  assert.match(report, /7\.5% pad/);
  assert.match(report, /\$5\/ft/);
  assert.match(report, /Nothing was sent to the customer/);
  assert.match(report, /Takedown: included at no charge/);
  assert.match(report, /Maintenance: included at no charge/);
  assert.match(report, /not shown to the customer/);
});

test('scale is required and empty drawings are not priced', () => {
  assert.equal(api.buildEstimate({ pxPerFt: 0, elements: [{ type: 'roofline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] }).ready, false);
  assert.equal(api.buildEstimate({ pxPerFt: 10, elements: [], tubs: 3 }).ready, false);
  assert.equal(api.customerView(api.buildEstimate({ pxPerFt: 0 })).ready, false);
});

test('default trunk diameter is 8 inches at the current scale', () => {
  assert.equal(api.defaultTreeDiameterPx(12), 8);
  assert.equal(api.defaultTreeDiameterPx(20), 8 / 12 * 20);
});
