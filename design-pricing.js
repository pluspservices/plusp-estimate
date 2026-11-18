/**
 * +P Holiday Lighting — customer design pricing.
 *
 * Erik: change prices in the PRICING object below. design.html loads this file.
 * Measured feet and computed light-feet are multiplied by (1 + footagePad)
 * before a price is calculated. Customer prices are whole dollars.
 * The customer page shows itemized prices and a range only — never footage.
 * The owner email (ownerReport) includes footage so it can be checked.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PlusPPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var PRICING = {
    // Extra length added to every measured run and every computed light-foot.
    footagePad: 0.075,
    rooflinePerFt: 5,
    gluePerFt: 6,
    ballPrice: 25,
    ballFeet: 25,
    // Trunks only. Height above this is not priced.
    treeMaxHeightFt: 10,
    // Ring spacing for a trunk wrap. Same shape of formula as bushes.
    // 1.5 in matches the owner estimator's default trunk spacing.
    treeSpacingIn: 1.5,
    // Used when the customer does not drag the trunk thickness handle.
    treeDefaultDiameterIn: 8,
    // lights_ft = circumference_ft * height_ft * 12 / bushSpacingIn
    bushSpacingIn: 4,
    storagePerTubPerYear: 25,
    // Customer range: low is the priced total, high is that total plus this fraction.
    rangeHighFraction: 0.15,
    // Visual C9 socket spacing along roofline and glued outlines.
    c9SpacingFt: 1,
    references: {
      garage2: { label: '2-car garage door', feet: 16 },
      garage1: { label: '1-car garage door', feet: 8 },
      door: { label: 'Front door', feet: 3 }
    }
  };

  var COLOR_LABELS = {
    warm: 'Warm white',
    cool: 'Cool white',
    multi: 'Multicolor',
    red: 'Red',
    green: 'Green',
    blue: 'Blue',
    'red-white': 'Red/White',
    'green-red': 'Green/Red',
    'blue-white': 'Blue/White'
  };

  var CATEGORY_LABELS = {
    roofline: 'Roofline',
    window: 'Windows',
    door: 'Doors',
    garage: 'Garages',
    archway: 'Archways',
    tree: 'Trees',
    bush: 'Bushes',
    storage: 'Storage'
  };

  var GLUE_TYPES = { window: 1, door: 1, garage: 1, archway: 1 };

  function padFactor() {
    return 1 + Number(PRICING.footagePad || 0);
  }

  function roundDollars(n) {
    return Math.round(Number(n) || 0);
  }

  function money(n) {
    var v = roundDollars(n);
    var sign = v < 0 ? '-' : '';
    var body = String(Math.abs(v));
    var withCommas = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + '$' + withCommas;
  }

  function formatRange(low, high) {
    var a = money(low);
    var b = money(high);
    if (a === b) return a;
    return a + '–' + b;
  }

  function feetLabel(n) {
    if (!(n > 0) || !isFinite(n)) return '0 ft';
    var rounded = Math.round(n * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.05) return String(Math.round(rounded)) + ' ft';
    return rounded.toFixed(1) + ' ft';
  }

  function colorLabel(id) {
    return COLOR_LABELS[id] || 'Warm white';
  }

  function polylineLength(points, closed) {
    if (!points || points.length < 2) return 0;
    var len = 0;
    for (var i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (closed && points.length > 2) {
      var a = points[0];
      var b = points[points.length - 1];
      var gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (gap > 0.5) len += gap;
    }
    return len;
  }

  function copyPt(p) { return { x: p.x, y: p.y }; }

  function samePt(a, b) {
    return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
  }

  /**
   * Window, door, garage, and arch outlines are lit on the sides and top only.
   * The bottom edge (sill / threshold) is left dark and is not priced.
   * Returns one or more open polylines. Rooflines are unchanged.
   * Safe to call again on its own result.
   */
  function litRuns(points, type) {
    if (!points || points.length < 2) return [];
    var pts = points.map(copyPt);
    if (!GLUE_TYPES[type] || pts.length < 3) return [pts];
    return stripBottomEdge(pts);
  }

  function stripBottomEdge(points) {
    var minY = Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < points.length; i++) {
      if (points[i].y < minY) minY = points[i].y;
      if (points[i].y > maxY) maxY = points[i].y;
    }
    var height = maxY - minY;
    if (!(height > 8)) return [points.map(copyPt)];

    var segs = [];
    for (var s = 1; s < points.length; s++) segs.push([points[s - 1], points[s]]);
    var first = points[0];
    var last = points[points.length - 1];
    var syntheticClose = Math.hypot(first.x - last.x, first.y - last.y) > 0.5;
    if (syntheticClose) segs.push([last, first]);

    var threshold = minY + height * 0.62;
    var drop = [];
    var any = false;
    for (var k = 0; k < segs.length; k++) {
      var a = segs[k][0];
      var b = segs[k][1];
      var dx = Math.abs(b.x - a.x);
      var dy = Math.abs(b.y - a.y);
      var midY = (a.y + b.y) / 2;
      var horizontal = dx + 0.01 >= dy * 0.85 && dx > 3;
      var low = midY >= threshold && Math.min(a.y, b.y) >= minY + height * 0.45;
      drop[k] = !!(horizontal && low);
      if (drop[k]) any = true;
    }
    if (!any) return [points.map(copyPt)];

    var runs = chainOpenSegments(segs, drop);
    if (!runs.length) return [points.map(copyPt)];
    return runs;
  }

  function chainOpenSegments(segs, drop) {
    var used = [];
    var runs = [];
    for (var i = 0; i < segs.length; i++) {
      if (drop[i] || used[i]) continue;
      var run = [copyPt(segs[i][0]), copyPt(segs[i][1])];
      used[i] = true;
      var guard = 0;
      var grew = true;
      while (grew && guard < segs.length + 2) {
        grew = false;
        guard++;
        for (var j = 0; j < segs.length; j++) {
          if (drop[j] || used[j]) continue;
          var s0 = segs[j][0];
          var s1 = segs[j][1];
          var start = run[0];
          var end = run[run.length - 1];
          if (samePt(s0, end)) { run.push(copyPt(s1)); used[j] = true; grew = true; }
          else if (samePt(s1, end)) { run.push(copyPt(s0)); used[j] = true; grew = true; }
          else if (samePt(s1, start)) { run.unshift(copyPt(s0)); used[j] = true; grew = true; }
          else if (samePt(s0, start)) { run.unshift(copyPt(s1)); used[j] = true; grew = true; }
        }
      }
      if (run.length >= 2) runs.push(run);
    }
    return runs;
  }

  function litLengthPx(points, type) {
    var runs = litRuns(points, type);
    var len = 0;
    for (var i = 0; i < runs.length; i++) len += polylineLength(runs[i], false);
    return len;
  }

  function bushLightsFt(circumferenceFt, heightFt) {
    var c = Number(circumferenceFt) || 0;
    var h = Number(heightFt) || 0;
    var spacing = Number(PRICING.bushSpacingIn) || 4;
    if (!(c > 0) || !(h > 0) || !(spacing > 0)) return 0;
    return c * h * 12 / spacing;
  }

  function treeLightsFt(circumferenceFt, heightFt) {
    var c = Number(circumferenceFt) || 0;
    var h = Number(heightFt) || 0;
    var spacing = Number(PRICING.treeSpacingIn) || 1.5;
    if (!(c > 0) || !(h > 0) || !(spacing > 0)) return 0;
    var pricedH = Math.min(h, Number(PRICING.treeMaxHeightFt) || 10);
    if (!(pricedH > 0)) return 0;
    return c * pricedH * 12 / spacing;
  }

  function priceLights(lightsFt) {
    var lights = Number(lightsFt) || 0;
    if (!(lights > 0)) return { lightsFt: 0, paddedFt: 0, balls: 0, price: 0 };
    var padded = lights * padFactor();
    var ballFeet = Number(PRICING.ballFeet) || 25;
    var balls = Math.ceil(padded / ballFeet - 1e-9);
    if (balls < 0) balls = 0;
    var price = balls * (Number(PRICING.ballPrice) || 0);
    return { lightsFt: lights, paddedFt: padded, balls: balls, price: price };
  }

  function defaultTreeDiameterPx(pxPerFt) {
    var inches = Number(PRICING.treeDefaultDiameterIn) || 8;
    return (inches / 12) * (Number(pxPerFt) || 0);
  }

  function emptyEstimate(reason) {
    return {
      ready: false,
      reason: reason || '',
      categories: [],
      low: 0,
      high: 0,
      included: includedLines()
    };
  }

  function includedLines() {
    return [
      { label: 'Takedown', amount: 0 },
      { label: 'Maintenance', amount: 0 }
    ];
  }

  function buildEstimate(input) {
    input = input || {};
    var pxPerFt = Number(input.pxPerFt);
    if (!(pxPerFt > 0) || !isFinite(pxPerFt)) return emptyEstimate('scale');
    var elements = input.elements || [];
    var buckets = {
      roofline: [],
      window: [],
      door: [],
      garage: [],
      archway: [],
      tree: [],
      bush: []
    };
    elements.forEach(function (el) {
      if (!el || !buckets[el.type]) return;
      var measured = measureElement(el, pxPerFt);
      if (measured) buckets[el.type].push(measured);
    });

    var categories = [];
    Object.keys(buckets).forEach(function (type) {
      var items = buckets[type];
      if (!items.length) return;
      if (type === 'tree' || type === 'bush') {
        var price = 0;
        var balls = 0;
        items.forEach(function (item) {
          price += item.price;
          balls += item.balls;
        });
        if (!(price > 0)) return;
        categories.push({
          id: type,
          label: CATEGORY_LABELS[type],
          price: price,
          balls: balls,
          items: items
        });
        return;
      }
      var lengthFt = 0;
      items.forEach(function (item) { lengthFt += item.lengthFt; });
      var rate = type === 'roofline' ? Number(PRICING.rooflinePerFt) : Number(PRICING.gluePerFt);
      var paddedFt = lengthFt * padFactor();
      var linearPrice = roundDollars(paddedFt * rate);
      if (!(linearPrice > 0) && !(lengthFt > 0)) return;
      if (!(linearPrice > 0)) return;
      categories.push({
        id: type,
        label: CATEGORY_LABELS[type],
        price: linearPrice,
        lengthFt: lengthFt,
        paddedFt: paddedFt,
        rate: rate,
        items: items
      });
    });

    var tubs = Math.max(0, Math.round(Number(input.tubs) || 0));
    var storagePrice = tubs * (Number(PRICING.storagePerTubPerYear) || 0);
    if (tubs > 0 && storagePrice > 0 && categories.length) {
      categories.push({
        id: 'storage',
        label: CATEGORY_LABELS.storage,
        price: storagePrice,
        tubs: tubs,
        items: []
      });
    }

    if (!categories.length) return emptyEstimate('empty');
    var hasLights = categories.some(function (c) { return c.id !== 'storage'; });
    if (!hasLights) return emptyEstimate('empty');

    var low = 0;
    categories.forEach(function (c) { low += c.price; });
    var high = roundDollars(low * (1 + Number(PRICING.rangeHighFraction || 0)));
    if (high < low) high = low;
    return {
      ready: true,
      reason: '',
      categories: categories,
      low: low,
      high: high,
      included: includedLines()
    };
  }

  function measureElement(el, pxPerFt) {
    if (el.type === 'tree') {
      var heightFt = (Number(el.heightPx) || 0) / pxPerFt;
      var diameterFt = (Number(el.diameterPx) || 0) / pxPerFt;
      if (!(heightFt > 0) || !(diameterFt > 0)) return null;
      var pricedHeightFt = Math.min(heightFt, Number(PRICING.treeMaxHeightFt) || 10);
      var circFt = Math.PI * diameterFt;
      var lights = treeLightsFt(circFt, heightFt);
      var priced = priceLights(lights);
      if (!(priced.price > 0)) return null;
      return {
        kind: 'tree',
        color: el.color || 'warm',
        heightFt: heightFt,
        pricedHeightFt: pricedHeightFt,
        diameterFt: diameterFt,
        diameterIn: diameterFt * 12,
        diameterMode: el.diameterMode || 'auto',
        circFt: circFt,
        lightsFt: priced.lightsFt,
        paddedFt: priced.paddedFt,
        balls: priced.balls,
        price: priced.price
      };
    }
    if (el.type === 'bush') {
      var widthFt = ((Number(el.rx) || 0) * 2) / pxPerFt;
      var bushHeightFt = ((Number(el.ry) || 0) * 2) / pxPerFt;
      if (!(widthFt > 0) || !(bushHeightFt > 0)) return null;
      var bushCirc = Math.PI * widthFt;
      var bushLights = bushLightsFt(bushCirc, bushHeightFt);
      var bushPriced = priceLights(bushLights);
      if (!(bushPriced.price > 0)) return null;
      return {
        kind: 'bush',
        color: el.color || 'warm',
        widthFt: widthFt,
        heightFt: bushHeightFt,
        circFt: bushCirc,
        lightsFt: bushPriced.lightsFt,
        paddedFt: bushPriced.paddedFt,
        balls: bushPriced.balls,
        price: bushPriced.price
      };
    }
    var sourcePts = (el.runs && el.runs.length) ? null : (el.points || []);
    var lengthPx = 0;
    if (el.runs && el.runs.length) {
      for (var ri = 0; ri < el.runs.length; ri++) lengthPx += polylineLength(el.runs[ri], false);
    } else {
      lengthPx = litLengthPx(sourcePts, el.type);
    }
    var lengthFt = lengthPx / pxPerFt;
    if (!(lengthFt > 0)) return null;
    return {
      kind: el.type,
      color: el.color || 'warm',
      lengthFt: lengthFt,
      closed: false,
      openBottom: !!GLUE_TYPES[el.type] && (el.points || []).length >= 3
    };
  }

  function customerView(est) {
    if (!est || !est.ready) {
      return { ready: false, lines: [], included: ['Takedown', 'Maintenance'], low: 0, high: 0, range: '' };
    }
    return {
      ready: true,
      lines: est.categories.map(function (c) {
        return { label: c.label, amount: c.price };
      }),
      included: ['Takedown', 'Maintenance'],
      low: est.low,
      high: est.high,
      range: formatRange(est.low, est.high)
    };
  }

  function ownerReport(est, info) {
    info = info || {};
    var lines = [];
    lines.push('+P Holiday Lighting — customer light design');
    lines.push('Pending your review and approval. Nothing was sent to the customer.');
    lines.push('');
    if (info.name) lines.push('Name: ' + info.name);
    if (info.phone) lines.push('Phone: ' + info.phone);
    if (info.email) lines.push('Email: ' + info.email);
    else lines.push('Email: (none)');
    if (info.address) lines.push('Address: ' + info.address);
    if (info.notes) lines.push('Notes: ' + info.notes);
    else lines.push('Notes: (none)');
    if (info.referredBy) lines.push('Referred by: ' + info.referredBy);
    else lines.push('Referred by: (none)');
    lines.push('');
    if (info.scale) {
      lines.push('Scale: ' + info.scale.label + ' = ' + feetLabel(info.scale.feet));
      if (info.scale.px) lines.push('Marked line: ' + Math.round(info.scale.px) + ' px (' + (Math.round(info.scale.pxPerFt * 100) / 100) + ' px per ft)');
      lines.push('');
    }
    if (!est || !est.ready) {
      lines.push('No priced design.');
      return lines.join('\n');
    }
    lines.push('Measured footage (for your check — not shown to the customer)');
    lines.push('');
    est.categories.forEach(function (cat) {
      if (cat.id === 'storage') {
        lines.push('Storage: ' + cat.tubs + ' tub' + (cat.tubs === 1 ? '' : 's') + ' × ' + money(PRICING.storagePerTubPerYear) + ' = ' + money(cat.price) + ' per year');
        lines.push('');
        return;
      }
      lines.push(cat.label);
      (cat.items || []).forEach(function (item, idx) {
        lines.push('  ' + (idx + 1) + '. ' + colorLabel(item.color) + ' — ' + itemSentence(item));
      });
      if (cat.lengthFt != null) {
        lines.push('  Total ' + feetLabel(cat.lengthFt) + ' × ' + padPercent() + ' pad = ' + feetLabel(cat.paddedFt) + ' × ' + money(cat.rate) + '/ft = ' + money(cat.price));
      } else if (cat.balls != null) {
        lines.push('  Total ' + cat.balls + ' ball' + (cat.balls === 1 ? '' : 's') + ' × ' + money(PRICING.ballPrice) + ' = ' + money(cat.price));
      }
      lines.push('');
    });
    lines.push('Takedown: included at no charge');
    lines.push('Maintenance: included at no charge');
    lines.push('');
    lines.push('Customer saw this estimated range (no footage on their screen): ' + formatRange(est.low, est.high));
    lines.push('Itemized starting prices sum to ' + money(est.low) + '.');
    lines.push('High end adds ' + Math.round(Number(PRICING.rangeHighFraction) * 1000) / 10 + '% for your review.');
    lines.push('');
    lines.push('Rates used: roofline ' + money(PRICING.rooflinePerFt) + '/ft, glued wall work ' + money(PRICING.gluePerFt) + '/ft, ' + money(PRICING.ballPrice) + ' per ' + PRICING.ballFeet + ' ft ball, pad ' + padPercent() + ', tree spacing ' + PRICING.treeSpacingIn + ' in, tree cap ' + PRICING.treeMaxHeightFt + ' ft, bush spacing ' + PRICING.bushSpacingIn + ' in, storage ' + money(PRICING.storagePerTubPerYear) + '/tub/year.');
    return lines.join('\n');
  }

  function padPercent() {
    return (Math.round(Number(PRICING.footagePad) * 1000) / 10) + '%';
  }

  function itemSentence(item) {
    if (item.kind === 'tree') {
      var capNote = item.heightFt > item.pricedHeightFt + 0.05
        ? (' (priced at ' + feetLabel(item.pricedHeightFt) + ' cap)')
        : '';
      var diamNote = item.diameterMode === 'manual'
        ? 'drawn thickness'
        : ('typical ' + PRICING.treeDefaultDiameterIn + ' in trunk, not resized');
      return 'trunk ' + feetLabel(item.heightFt) + ' high' + capNote + ', diameter ' + (Math.round(item.diameterIn * 10) / 10) + ' in (' + diamNote + '), circumference ' + feetLabel(item.circFt) + ', lights ' + feetLabel(item.lightsFt) + ', with pad ' + feetLabel(item.paddedFt) + ', ' + item.balls + ' ball' + (item.balls === 1 ? '' : 's') + ' × ' + money(PRICING.ballPrice) + ' = ' + money(item.price);
    }
    if (item.kind === 'bush') {
      return 'width ' + feetLabel(item.widthFt) + ', height ' + feetLabel(item.heightFt) + ', circumference ' + feetLabel(item.circFt) + ' (π × width), lights ' + feetLabel(item.lightsFt) + ' = circumference × height × 12 / ' + PRICING.bushSpacingIn + ', with pad ' + feetLabel(item.paddedFt) + ', ' + item.balls + ' ball' + (item.balls === 1 ? '' : 's') + ' × ' + money(PRICING.ballPrice) + ' = ' + money(item.price);
    }
    if (item.openBottom) return 'sides and top only (bottom left dark) ' + feetLabel(item.lengthFt);
    return 'line ' + feetLabel(item.lengthFt);
  }

  return {
    PRICING: PRICING,
    COLOR_LABELS: COLOR_LABELS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    GLUE_TYPES: GLUE_TYPES,
    money: money,
    formatRange: formatRange,
    feetLabel: feetLabel,
    colorLabel: colorLabel,
    polylineLength: polylineLength,
    litRuns: litRuns,
    litLengthPx: litLengthPx,
    bushLightsFt: bushLightsFt,
    treeLightsFt: treeLightsFt,
    priceLights: priceLights,
    defaultTreeDiameterPx: defaultTreeDiameterPx,
    roundDollars: roundDollars,
    buildEstimate: buildEstimate,
    customerView: customerView,
    ownerReport: ownerReport
  };
});
