'use strict';
/* +P customer light designer. Pricing lives in design-pricing.js. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var P = window.PlusPPricing;
  var PROSPECTS_API = 'https://script.google.com/macros/s/AKfycbzbvvFGqolPI0zKlmWQhngCW-oDjz7mSR6hZflztejyeS_NxzVteUOxJE3gH_MOJO3gcg/exec';
  var WEB3FORMS_KEY = '4f873478-15cb-4e7a-9c1b-4273efd977da';
  var LINE_TOOLS = { roofline: 1, window: 1, door: 1, garage: 1, archway: 1 };
  var OPEN_BOTTOM = { door: 1, garage: 1, archway: 1 };
  var TYPE_LABELS = {
    roofline: 'Roofline',
    window: 'Window',
    door: 'Door',
    garage: 'Garage',
    archway: 'Archway',
    tree: 'Tree',
    bush: 'Bush'
  };
  var HINTS = {
    roofline: {
      straight: 'Tap each bend in the roof. Straight lines connect the taps. Tap Done when it looks right.',
      freehand: 'Drag your finger along the roof. Lift your finger to finish the curve.'
    },
    window: {
      straight: 'Tap all four corners of the window, then tap Done. Lights go all the way around.',
      freehand: 'Drag all the way around the window, then lift your finger. Lights go on every side.'
    },
    door: {
      straight: 'Tap the top corners, then the bottom corners, and tap Done. Lights go up the sides and across the top only.',
      freehand: 'Drag the sides and the top, then lift. We don’t light across the bottom.'
    },
    garage: {
      straight: 'Tap the top corners of the garage door, then the bottom corners, and tap Done. The bottom stays open.',
      freehand: 'Drag the sides and the top of the garage door, then lift. The bottom edge is left dark.'
    },
    archway: {
      straight: 'Tap along the curve and down both sides, then tap Done. The bottom stays open.',
      freehand: 'Drag the curve and the sides, then lift. We won’t put lights across the bottom.'
    },
    tree: 'Drag from the ground up the trunk. Tap Edit, then drag the side dot so the trunk thickness matches the tree.',
    bush: 'Press on the bush and drag across it. That sets how wide and how tall the wrap is.',
    select: 'Tap a string of lights to change its color or delete it. Drag a white dot to adjust it.',
    scale: 'Drag straight across, from the left edge to the right edge. Keep the line level. Not corner to corner.'
  };
  var COLOR_STYLES = {
    warm: ['#ffd7a1'],
    cool: ['#e7f6ff'],
    multi: ['#ff4d4d', '#3dff7a', '#4db2ff', '#ffe14a', '#ff7ad9'],
    red: ['#ff3b3b'],
    green: ['#3dff7a'],
    blue: ['#4db2ff'],
    'red-white': ['#ff3b3b', '#fff4e0'],
    'green-red': ['#3dff7a', '#ff3b3b'],
    'blue-white': ['#4db2ff', '#fff4e0']
  };

  var photo = null;
  var elements = [];
  var scaleMark = null;
  var scaleAttempt = null;
  var draft = null;
  var undoStack = [];
  var selectedId = null;
  var tool = 'roofline';
  var drawTool = 'roofline';
  var lineMode = 'straight';
  var formFocused = false;
  var currentColor = 'warm';
  var night = false;
  var view = { scale: 1, tx: 0, ty: 0, dpr: 1 };
  var seq = 1;
  var apiReady = false;
  var sending = false;
  var lastStageW = 0;
  var canvas = $('draw');
  var scene = document.createElement('canvas');
  var sceneCtx = scene.getContext('2d');
  var active = new Map();
  var gesture = null;
  var pinch = null;
  var spriteCache = new Map();
  var raf = 0;

  function uid() { return 'e' + (seq++); }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function showErr(id, msg) {
    var el = $(id);
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideErr(id) { $(id).classList.add('hidden'); }

  function tubCount() {
    var n = Math.round(Number($('tubs').value) || 0);
    return clamp(n, 0, 40);
  }

  function currentRefFeet() {
    var key = $('scaleRef').value;
    if (key === 'custom') {
      var n = Number($('customFeet').value);
      if (!(n > 0) || n > 80) return 0;
      return n;
    }
    var ref = P.PRICING.references[key];
    return ref ? ref.feet : 0;
  }

  function currentRefLabel() {
    var key = $('scaleRef').value;
    if (key === 'custom') return 'Custom width';
    var ref = P.PRICING.references[key];
    return ref ? ref.label : 'Reference';
  }

  function pxPerFt() {
    if (!scaleMark) return 0;
    var px = Math.hypot(scaleMark.x2 - scaleMark.x1, scaleMark.y2 - scaleMark.y1);
    if (!(px > 0) || !(scaleMark.feet > 0)) return 0;
    return px / scaleMark.feet;
  }

  function elementById(id) {
    for (var i = 0; i < elements.length; i++) if (elements[i].id === id) return elements[i];
    return null;
  }

  function runsOf(el) {
    if (!el) return [];
    if (el.runs && el.runs.length) return el.runs;
    if (el.points && P.litRuns) return P.litRuns(el.points, el.type);
    if (el.points) return [el.points];
    return [];
  }

  function treeDiameterPx(el) {
    var px = pxPerFt();
    if (el.diameterMode === 'manual') return el.diameterPx || 12;
    if (px > 0) return P.defaultTreeDiameterPx(px);
    return el.diameterPx || 18;
  }

  function pricingElements() {
    var px = pxPerFt();
    return elements.map(function (el) {
      if (el.type === 'tree') {
        return {
          type: 'tree',
          color: el.color,
          heightPx: Math.hypot(el.x2 - el.x1, el.y2 - el.y1),
          diameterPx: treeDiameterPx(el),
          diameterMode: el.diameterMode || 'auto'
        };
      }
      if (el.type === 'bush') {
        return { type: 'bush', color: el.color, rx: el.rx, ry: el.ry };
      }
      return { type: el.type, color: el.color, closed: false, points: el.points, runs: el.runs };
    });
  }

  function currentEstimate() {
    return P.buildEstimate({
      pxPerFt: pxPerFt(),
      tubs: tubCount(),
      elements: pricingElements()
    });
  }

  function pushUndo() {
    undoStack.push(JSON.stringify({ elements: elements, scaleMark: scaleMark }));
    if (undoStack.length > 40) undoStack.shift();
    syncChrome();
  }

  function undoLast() {
    if (draft && draft.points && draft.points.length) {
      draft.points.pop();
      if (!draft.points.length) draft = null;
      syncChrome();
      requestRedraw();
      return;
    }
    var raw = undoStack.pop();
    if (!raw) return;
    var data = JSON.parse(raw);
    elements = data.elements || [];
    scaleMark = data.scaleMark || null;
    selectedId = null;
    syncUi();
  }

  function deleteSelected() {
    if (!selectedId) return;
    pushUndo();
    elements = elements.filter(function (el) { return el.id !== selectedId; });
    selectedId = null;
    syncUi();
  }

  function setColor(id) {
    currentColor = id;
    if (tool === 'select' && selectedId) {
      var el = elementById(selectedId);
      if (el && el.color !== id) {
        pushUndo();
        el.color = id;
      }
    }
    if (draft) draft.color = id;
    renderColors();
    syncUi();
  }

  function renderColors() {
    var box = $('colors');
    box.innerHTML = '';
    Object.keys(P.COLOR_LABELS).forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (id === currentColor ? ' on' : '');
      var dot = document.createElement('span');
      dot.className = 'dot';
      var cols = COLOR_STYLES[id] || ['#ffd7a1'];
      dot.style.background = cols.length > 1 ? ('linear-gradient(90deg,' + cols.join(',') + ')') : cols[0];
      b.appendChild(dot);
      b.appendChild(document.createTextNode(P.COLOR_LABELS[id]));
      b.addEventListener('click', function () { setColor(id); });
      box.appendChild(b);
    });
  }

  function toolTip(which) {
    var spec = HINTS[which || tool] || HINTS.roofline;
    if (typeof spec === 'string') return spec;
    var mode = lineMode === 'freehand' ? 'freehand' : 'straight';
    return spec[mode] || spec.straight;
  }

  function setLineMode(next) {
    if (next !== 'freehand' && next !== 'straight') return;
    if (draft && draft.points && draft.points.length >= 2) commitDraft();
    else if (lineMode !== next) draft = null;
    lineMode = next;
    updateToolUi();
    requestRedraw();
  }

  function setTool(next) {
    if (draft && draft.points && LINE_TOOLS[tool]) {
      if (draft.points.length >= 2) commitDraft();
      else draft = null;
    }
    tool = next;
    if (LINE_TOOLS[next] || next === 'tree' || next === 'bush') drawTool = next;
    updateToolUi();
    requestRedraw();
  }

  function updateToolUi() {
    document.querySelectorAll('.tool').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-tool') === tool);
    });
    var tip = toolTip();
    $('toolHint').textContent = tip;
    if ($('modeStraight')) $('modeStraight').classList.toggle('on', lineMode === 'straight');
    if ($('modeFreehand')) $('modeFreehand').classList.toggle('on', lineMode === 'freehand');
    if ($('modeHint')) {
      $('modeHint').textContent = lineMode === 'freehand'
        ? 'Drag to draw a curve. Lift your finger to finish. Undo removes that stroke.'
        : 'Tap each point. Straight lines connect them. Tap Done to finish. Undo removes the last tap.';
    }
    var showModes = !!LINE_TOOLS[tool];
    if ($('lineModes')) $('lineModes').classList.toggle('hidden', !showModes);
    if ($('modeHint')) $('modeHint').classList.toggle('hidden', !showModes);
    $('closeBtn').classList.add('hidden');
    $('markScaleBtn').textContent = tool === 'scale' ? 'Marking… drag across the width' : 'Mark this width on the photo';
    syncChrome();
  }

  function syncChrome() {
    var canUndo = (draft && draft.points && draft.points.length) || undoStack.length > 0;
    $('undoBtn').disabled = !canUndo;
    $('deleteBtn').disabled = !selectedId;
    var straightDraft = lineMode === 'straight' && !!LINE_TOOLS[tool];
    $('doneBtn').classList.toggle('hidden', !straightDraft);
    $('doneBtn').disabled = !(straightDraft && draft && draft.points && draft.points.length >= 2);
    if (pxPerFt() > 0) $('scaleState').textContent = 'Scale set.';
    else if (tool === 'scale') $('scaleState').textContent = 'Drag across the reference on the photo.';
    else $('scaleState').textContent = 'Scale not set yet.';
    updateGuide();
  }

  function updateGuide() {
    var step = 1;
    if (!photo) step = 1;
    else if (!(pxPerFt() > 0) || tool === 'scale') step = 2;
    else if (!elements.length) step = 3;
    else if (formFocused) step = 5;
    else step = 4;
    var titles = [
      'Add a photo of the front of your house',
      'Mark something you know the width of',
      'Pick a tool and a color, then trace your lights',
      'Review your estimate',
      'Enter your info and send'
    ];
    var tips = [
      'Tap Take a photo or Choose a photo. A straight-on picture of the front works best.',
      'Drag straight across the garage door or front door, left edge to right edge. Keep it level — not corner to corner.',
      toolTip() + ' Undo takes back the last tap or stroke. Pinch, or use + and −, to zoom.',
      toolTip() + ' Scroll down for the price range. It’s an estimate until we review it.',
      'Add your name, phone, and address, then tap Send my design. We’ll text you. Nothing is emailed to you.'
    ];
    if ($('stepLabel')) $('stepLabel').textContent = 'Step ' + step + ' of 5';
    if ($('stepTitle')) $('stepTitle').textContent = titles[step - 1];
    if ($('stepTip')) $('stepTip').textContent = tips[step - 1];
    for (var i = 1; i <= 5; i++) {
      var li = $('guide' + i);
      if (li) li.classList.toggle('now', i === step);
    }
  }

  function renderList() {
    var ul = $('elementList');
    ul.innerHTML = '';
    elements.forEach(function (el) {
      var li = document.createElement('li');
      if (el.id === selectedId) li.classList.add('on');
      var span = document.createElement('span');
      span.textContent = (TYPE_LABELS[el.type] || 'Light') + ' · ' + P.colorLabel(el.color);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Delete';
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectedId = el.id;
        deleteSelected();
      });
      li.addEventListener('click', function () {
        selectedId = el.id;
        tool = 'select';
        updateToolUi();
        requestRedraw();
      });
      li.appendChild(span);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function renderEstimate() {
    var est = currentEstimate();
    var viewSafe = P.customerView(est);
    var body = $('estimateBody');
    if (!viewSafe.ready) {
      var msg = 'Set a scale and draw lights to see an estimated price range.';
      if (pxPerFt() > 0 && elements.length) msg = 'Draw a longer run to see an estimated price range.';
      else if (pxPerFt() > 0) msg = 'Draw lights on the photo to see an estimated price range.';
      else if (elements.length) msg = 'Mark a known width to see an estimated price range.';
      body.innerHTML = '<p class="hint">' + msg + '</p>';
      return;
    }
    var html = '';
    viewSafe.lines.forEach(function (line) {
      html += '<div class="line"><span>' + line.label + '</span><strong>' + P.money(line.amount) + '</strong></div>';
    });
    html += '<div class="line"><span>Takedown</span><strong>Included</strong></div>';
    html += '<div class="line"><span>Maintenance</span><strong>Included</strong></div>';
    html += '<p class="total" id="estimateRange">' + viewSafe.range + '</p>';
    html += '<p class="note">Estimated price range — pending owner review and approval. This is not a final quote.</p>';
    html += '<p class="hint">Takedown and maintenance are included at no charge. Item prices are the starting estimate.</p>';
    body.innerHTML = html;
  }

  function syncUi() {
    renderEstimate();
    renderList();
    syncChrome();
    requestRedraw();
  }

  function requestRedraw() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      redraw();
    });
  }

  function ensureScene() {
    if (!photo) return;
    if (scene.width !== photo.w || scene.height !== photo.h) {
      scene.width = photo.w;
      scene.height = photo.h;
      sceneCtx = scene.getContext('2d');
    }
  }

  function containScale() {
    if (!photo) return 1;
    return Math.min(canvas.clientWidth / photo.w, canvas.clientHeight / photo.h) || 1;
  }

  function layoutCanvas(refit) {
    if (!photo) return;
    var wrap = $('stage');
    var cssW = wrap.clientWidth || 320;
    var maxH = Math.max(240, Math.round(window.innerHeight * 0.58));
    var cssH = Math.round(cssW * (photo.h / photo.w));
    if (cssH > maxH) cssH = maxH;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * view.dpr);
    canvas.height = Math.round(cssH * view.dpr);
    lastStageW = cssW;
    ensureScene();
    if (refit) fitView();
    else requestRedraw();
  }

  function fitView() {
    var s = containScale();
    view.scale = s;
    view.tx = (canvas.clientWidth - photo.w * s) / 2;
    view.ty = (canvas.clientHeight - photo.h * s) / 2;
    requestRedraw();
  }

  function zoomBy(factor) {
    if (!photo) return;
    var cx = canvas.clientWidth / 2;
    var cy = canvas.clientHeight / 2;
    var ix = (cx - view.tx) / view.scale;
    var iy = (cy - view.ty) / view.scale;
    var base = containScale();
    var next = clamp(view.scale * factor, base * 0.5, base * 8);
    view.scale = next;
    view.tx = cx - ix * next;
    view.ty = cy - iy * next;
    requestRedraw();
  }

  function uiPx(n, interactive) {
    return interactive ? n / (view.scale || 1) : n;
  }

  function bulbRadius(interactive) {
    if (interactive) return uiPx(3.4, true);
    var px = pxPerFt();
    return clamp(px > 0 ? px * 0.2 : 4.5, 3, 8);
  }

  function spacingFor(kind, interactive) {
    var px = pxPerFt();
    var raw;
    if (kind === 'tree' || kind === 'bush') {
      var inches = kind === 'tree' ? P.PRICING.treeSpacingIn : P.PRICING.bushSpacingIn;
      raw = px > 0 ? (inches / 12) * px : 12;
    } else {
      raw = px > 0 ? P.PRICING.c9SpacingFt * px : 22;
    }
    if (interactive) return Math.max(raw, uiPx(13, true));
    return Math.max(8, raw);
  }

  function bulbsAlong(points, closed, spacing) {
    var path = points.slice();
    if (closed && points.length > 2) path.push(points[0]);
    var out = [];
    if (path.length < 2 || !(spacing > 0)) return out;
    var nextAt = 0;
    var walked = 0;
    for (var i = 1; i < path.length; i++) {
      var a = path[i - 1];
      var b = path[i];
      var seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg < 1e-6) continue;
      while (nextAt <= walked + seg + 1e-6) {
        var t = (nextAt - walked) / seg;
        if (t >= -0.001 && t <= 1.001) {
          out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        nextAt += spacing;
        if (out.length > 700) return out;
      }
      walked += seg;
    }
    return out;
  }

  function sprite(hex) {
    if (spriteCache.has(hex)) return spriteCache.get(hex);
    var s = 64;
    var c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.08, hex);
    grd.addColorStop(0.2, hex);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
    spriteCache.set(hex, c);
    return c;
  }

  function drawBulbs(ctx, bulbs, colorId, nightMode, interactive) {
    var colors = COLOR_STYLES[colorId] || COLOR_STYLES.warm;
    var r = bulbRadius(interactive);
    for (var i = 0; i < bulbs.length; i++) {
      var b = bulbs[i];
      var hex = colors[i % colors.length];
      if (nightMode) {
        var glow = r * 2.35;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(sprite(hex), b.x - glow, b.y - glow, glow * 2, glow * 2);
        ctx.restore();
        ctx.beginPath();
        ctx.fillStyle = hex;
        ctx.arc(b.x, b.y, r * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = '#fff8ea';
        ctx.arc(b.x - r * 0.22, b.y - r * 0.22, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.arc(b.x, b.y, r + uiPx(1.3, interactive), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = hex;
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.arc(b.x - r * 0.28, b.y - r * 0.28, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function strokePath(ctx, points, closed, color, width) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawHandle(ctx, x, y, interactive) {
    if (!interactive) return;
    var r = uiPx(11, true);
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e8b84a';
    ctx.lineWidth = uiPx(2, true);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function treeBulbs(el, diameterPx, spacing) {
    var len = Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
    if (len < 1) return [];
    var ux = (el.x2 - el.x1) / len;
    var uy = (el.y2 - el.y1) / len;
    var px = -uy;
    var py = ux;
    var radius = diameterPx / 2;
    var out = [];
    var step = Math.max(spacing, 6);
    for (var d = 0; d <= len; d += step) {
      var ang = (d / Math.max(diameterPx, 8)) * Math.PI * 2;
      var off = Math.sin(ang) * radius;
      out.push({ x: el.x1 + ux * d + px * off, y: el.y1 + uy * d + py * off });
      if (out.length > 400) break;
    }
    return out;
  }

  function bushBulbs(el, spacing) {
    var rings = clamp(Math.round((el.ry * 2) / Math.max(spacing, 8)), 3, 14);
    var out = [];
    for (var i = 0; i < rings; i++) {
      var ty = -el.ry + (el.ry * 2) * ((i + 0.5) / rings);
      var ny = el.ry ? ty / el.ry : 0;
      var rx = el.rx * Math.sqrt(Math.max(0.2, 1 - ny * ny));
      var steps = clamp(Math.round((2 * Math.PI * rx) / Math.max(spacing, 8)), 6, 28);
      for (var s = 0; s < steps; s++) {
        var a = (s / steps) * Math.PI * 2 + i * 0.35;
        out.push({ x: el.cx + Math.cos(a) * rx, y: el.cy + ty });
        if (out.length > 450) return out;
      }
    }
    return out;
  }

  function paintScene(ctx, opts) {
    if (!photo) return;
    var interactive = !!opts.interactive;
    var nightMode = !!opts.night;
    var w = photo.w;
    var h = photo.h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(photo.canvas, 0, 0, w, h);
    if (nightMode) {
      ctx.fillStyle = 'rgba(2, 6, 18, 0.62)';
      ctx.fillRect(0, 0, w, h);
    }
    elements.forEach(function (el) {
      drawElement(ctx, el, nightMode, interactive, el.id === selectedId);
    });
    if (draft && draft.points && draft.points.length) {
      strokePath(ctx, draft.points, false, '#e8b84a', uiPx(2.5, interactive));
      if (interactive) draft.points.forEach(function (p) { drawHandle(ctx, p.x, p.y, true); });
    }
    if (gesture && interactive) drawGesture(ctx, nightMode);
    if (scaleMark) {
      var label = opts.forOwner ? (currentRefLabel() + ' · ' + scaleMark.feet + ' ft') : 'Scale';
      drawScaleLine(ctx, scaleMark.x1, scaleMark.y1, scaleMark.x2, scaleMark.y2, label, interactive, '#e8b84a');
    } else if (scaleAttempt && interactive) {
      drawScaleLine(ctx, scaleAttempt.x1, scaleAttempt.y1, scaleAttempt.x2, scaleAttempt.y2, 'Redo level', interactive, '#ff8f6b');
    }
    if (gesture && gesture.mode === 'scale') {
      drawScaleLine(ctx, gesture.x1, gesture.y1, gesture.x2, gesture.y2, 'Scale', interactive, '#e8b84a');
    }
  }

  function drawElement(ctx, el, nightMode, interactive, selected) {
    if (el.type === 'tree') {
      var diam = treeDiameterPx(el);
      strokePath(ctx, [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }], false, nightMode ? 'rgba(220,210,190,0.35)' : 'rgba(70,48,32,0.85)', Math.max(uiPx(2, interactive), diam * 0.18));
      drawBulbs(ctx, treeBulbs(el, diam, spacingFor('tree', interactive)), el.color, nightMode, interactive);
      if (selected) {
        strokePath(ctx, [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }], false, '#e8b84a', uiPx(2, interactive));
        drawHandle(ctx, el.x1, el.y1, interactive);
        drawHandle(ctx, el.x2, el.y2, interactive);
        var wh = treeWidthHandle(el, diam);
        drawHandle(ctx, wh.x, wh.y, interactive);
      }
      return;
    }
    if (el.type === 'bush') {
      ctx.save();
      ctx.strokeStyle = nightMode ? 'rgba(210,230,210,0.4)' : 'rgba(20,70,30,0.8)';
      ctx.lineWidth = uiPx(2, interactive);
      ctx.beginPath();
      ctx.ellipse(el.cx, el.cy, Math.max(1, el.rx), Math.max(1, el.ry), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      drawBulbs(ctx, bushBulbs(el, spacingFor('bush', interactive)), el.color, nightMode, interactive);
      if (selected) {
        ctx.save();
        ctx.strokeStyle = '#e8b84a';
        ctx.lineWidth = uiPx(2, interactive);
        ctx.beginPath();
        ctx.ellipse(el.cx, el.cy, Math.max(1, el.rx), Math.max(1, el.ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        drawHandle(ctx, el.cx, el.cy, interactive);
        drawHandle(ctx, el.cx + el.rx, el.cy, interactive);
        drawHandle(ctx, el.cx, el.cy + el.ry, interactive);
      }
      return;
    }
    var cord = nightMode ? 'rgba(214,224,206,0.45)' : 'rgba(18,36,22,0.8)';
    var runs = runsOf(el);
    var spacing = spacingFor(el.type, interactive);
    runs.forEach(function (run) {
      strokePath(ctx, run, false, selected ? '#e8b84a' : cord, uiPx(selected ? 3 : 2.2, interactive));
      drawBulbs(ctx, bulbsAlong(run, false, spacing), el.color, nightMode, interactive);
      if (selected && interactive) run.forEach(function (p) { drawHandle(ctx, p.x, p.y, true); });
    });
  }

  function drawGesture(ctx, nightMode) {
    if (gesture.mode === 'tree') {
      strokePath(ctx, [{ x: gesture.x1, y: gesture.y1 }, { x: gesture.x2, y: gesture.y2 }], false, '#e8b84a', uiPx(3, true));
    } else if (gesture.mode === 'bush') {
      ctx.save();
      ctx.strokeStyle = '#e8b84a';
      ctx.lineWidth = uiPx(2, true);
      ctx.beginPath();
      ctx.ellipse(gesture.cx, gesture.cy, Math.max(1, gesture.rx), Math.max(1, gesture.ry), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (gesture.mode === 'poly') {
      if (lineMode === 'freehand') {
        if (gesture.kept && gesture.kept.length >= 2) strokePath(ctx, gesture.kept, false, '#e8b84a', uiPx(2.5, true));
      } else {
        var base = (draft && draft.type === tool && draft.points && draft.points.length) ? draft.points : [gesture.start];
        var preview = base.slice();
        if (gesture.cursor) preview.push(gesture.cursor);
        if (preview.length >= 2) strokePath(ctx, preview, false, '#e8b84a', uiPx(2.5, true));
        if (draft && draft.points) draft.points.forEach(function (p) { drawHandle(ctx, p.x, p.y, true); });
      }
    }
  }

  function lineTiltDegrees(x1, y1, x2, y2) {
    var angle = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
    if (angle > 90) angle = 180 - angle;
    return angle;
  }

  function drawScaleLine(ctx, x1, y1, x2, y2, label, interactive, color) {
    ctx.save();
    ctx.strokeStyle = color || '#e8b84a';
    ctx.fillStyle = '#1a1200';
    ctx.lineWidth = uiPx(3, interactive);
    ctx.setLineDash([uiPx(10, interactive), uiPx(7, interactive)]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color || '#e8b84a';
    var r = uiPx(6, interactive);
    ctx.beginPath(); ctx.arc(x1, y1, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, r, 0, Math.PI * 2); ctx.fill();
    var size = uiPx(15, interactive);
    ctx.font = '700 ' + size + 'px system-ui,sans-serif';
    ctx.lineWidth = uiPx(4, interactive);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    var tx = (x1 + x2) / 2 + uiPx(6, interactive);
    var ty = (y1 + y2) / 2 - uiPx(8, interactive);
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = '#ffe7a3';
    ctx.fillText(label, tx, ty);
    ctx.restore();
  }

  function redraw() {
    if (!photo) return;
    ensureScene();
    sceneCtx.setTransform(1, 0, 0, 1, 0, 0);
    paintScene(sceneCtx, { night: night, interactive: true, forOwner: false });
    var ctx = canvas.getContext('2d');
    var dpr = view.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070b10';
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(scene, view.tx, view.ty, photo.w * view.scale, photo.h * view.scale);
  }

  function clientPoint(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function imageFromClient(cp) {
    return { x: (cp.x - view.tx) / view.scale, y: (cp.y - view.ty) / view.scale };
  }

  function screenFromImage(ix, iy) {
    var r = canvas.getBoundingClientRect();
    return { x: r.left + view.tx + ix * view.scale, y: r.top + view.ty + iy * view.scale };
  }

  function distToSeg(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  function treeWidthHandle(el, diam) {
    var mx = (el.x1 + el.x2) / 2;
    var my = (el.y1 + el.y2) / 2;
    var dx = el.x2 - el.x1;
    var dy = el.y2 - el.y1;
    var len = Math.hypot(dx, dy) || 1;
    var off = Math.max(diam / 2, uiPx(16, true));
    return { x: mx + (-dy / len) * off, y: my + (dx / len) * off };
  }

  function hitHandles(el, ip, handleR) {
    if (!el) return null;
    if (el.points || (el.runs && el.runs.length)) {
      var runs = runsOf(el);
      for (var r = 0; r < runs.length; r++) {
        for (var i = 0; i < runs[r].length; i++) {
          if (Math.hypot(runs[r][i].x - ip.x, runs[r][i].y - ip.y) <= handleR) {
            return { id: el.id, part: 'vertex', index: i, run: r };
          }
        }
      }
    } else if (el.type === 'tree') {
      if (Math.hypot(el.x1 - ip.x, el.y1 - ip.y) <= handleR) return { id: el.id, part: 'p1' };
      if (Math.hypot(el.x2 - ip.x, el.y2 - ip.y) <= handleR) return { id: el.id, part: 'p2' };
      var wh = treeWidthHandle(el, treeDiameterPx(el));
      if (Math.hypot(wh.x - ip.x, wh.y - ip.y) <= handleR) return { id: el.id, part: 'width' };
    } else if (el.type === 'bush') {
      if (Math.hypot(el.cx - ip.x, el.cy - ip.y) <= handleR) return { id: el.id, part: 'center' };
      if (Math.hypot(el.cx + el.rx - ip.x, el.cy - ip.y) <= handleR) return { id: el.id, part: 'rx' };
      if (Math.hypot(el.cx - ip.x, el.cy + el.ry - ip.y) <= handleR) return { id: el.id, part: 'ry' };
    }
    return null;
  }

  function elementHits(el, ip, bodyR) {
    if (el.points || (el.runs && el.runs.length)) {
      var runs = runsOf(el);
      for (var r = 0; r < runs.length; r++) {
        var pts = runs[r];
        for (var i = 1; i < pts.length; i++) {
          if (distToSeg(ip, pts[i - 1], pts[i]) <= bodyR) return true;
        }
      }
      return false;
    }
    if (el.type === 'tree') {
      return distToSeg(ip, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) <= bodyR + treeDiameterPx(el) / 2;
    }
    if (el.type === 'bush') {
      var nx = (ip.x - el.cx) / (el.rx + bodyR);
      var ny = (ip.y - el.cy) / (el.ry + bodyR);
      return nx * nx + ny * ny <= 1;
    }
    return false;
  }

  function hitTest(ip) {
    var handleR = uiPx(20, true);
    var bodyR = uiPx(16, true);
    if (selectedId) {
      var handle = hitHandles(elementById(selectedId), ip, handleR);
      if (handle) return handle;
    }
    for (var i = elements.length - 1; i >= 0; i--) {
      if (elementHits(elements[i], ip, bodyR)) return { id: elements[i].id, part: 'move' };
    }
    return null;
  }

  function applyEdit(hit, ip, dx, dy) {
    var el = elementById(hit.id);
    if (!el) return;
    if (hit.part === 'move') {
      if (el.runs && el.runs.length) {
        el.runs.forEach(function (run) { run.forEach(function (p) { p.x += dx; p.y += dy; }); });
      } else if (el.points) el.points.forEach(function (p) { p.x += dx; p.y += dy; });
      else if (el.type === 'tree') { el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy; }
      else if (el.type === 'bush') { el.cx += dx; el.cy += dy; }
      return;
    }
    if (hit.part === 'vertex') {
      var runs = runsOf(el);
      var run = runs[hit.run || 0];
      if (run && run[hit.index]) {
        run[hit.index].x += dx;
        run[hit.index].y += dy;
      }
      return;
    }
    if (hit.part === 'p1') { el.x1 += dx; el.y1 += dy; return; }
    if (hit.part === 'p2') { el.x2 += dx; el.y2 += dy; return; }
    if (hit.part === 'width') {
      el.diameterMode = 'manual';
      el.diameterPx = clamp(distToSeg(ip, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) * 2, 4, Math.max(photo.w, photo.h));
      return;
    }
    if (hit.part === 'center') { el.cx += dx; el.cy += dy; return; }
    if (hit.part === 'rx') { el.rx = Math.max(8, Math.abs(ip.x - el.cx)); return; }
    if (hit.part === 'ry') { el.ry = Math.max(8, Math.abs(ip.y - el.cy)); }
  }

  function pointLineDistance(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  }

  function rdp(points, epsilon) {
    if (points.length < 3) return points.map(function (p) { return { x: p.x, y: p.y }; });
    var first = points[0];
    var last = points[points.length - 1];
    var maxDist = 0;
    var idx = 0;
    for (var i = 1; i < points.length - 1; i++) {
      var d = pointLineDistance(points[i], first, last);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > epsilon) {
      var left = rdp(points.slice(0, idx + 1), epsilon);
      var right = rdp(points.slice(idx), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [{ x: first.x, y: first.y }, { x: last.x, y: last.y }];
  }

  function smoothFreehand(points) {
    if (!points || points.length < 3) return (points || []).map(function (p) { return { x: p.x, y: p.y }; });
    var src = points.map(function (p) { return { x: p.x, y: p.y }; });
    for (var pass = 0; pass < 2; pass++) {
      var next = [src[0]];
      for (var i = 1; i < src.length - 1; i++) {
        next.push({
          x: src[i - 1].x * 0.25 + src[i].x * 0.5 + src[i + 1].x * 0.25,
          y: src[i - 1].y * 0.25 + src[i].y * 0.5 + src[i + 1].y * 0.25
        });
      }
      next.push(src[src.length - 1]);
      src = next;
    }
    return rdp(src, 3.5);
  }

  function storeLine(points, type, mode) {
    var runs = P.litRuns ? P.litRuns(points, type) : [points];
    var length = 0;
    runs.forEach(function (run) { length += P.polylineLength(run, false); });
    if (length < 8 || !runs.length) {
      syncChrome();
      requestRedraw();
      return;
    }
    pushUndo();
    var el = {
      id: uid(),
      type: type,
      color: currentColor,
      closed: false,
      points: runs[0],
      runs: runs,
      drawMode: mode || lineMode
    };
    elements.push(el);
    selectedId = el.id;
    syncUi();
  }

  function commitPolyline(pts) {
    var points = pts.map(function (p) { return { x: p.x, y: p.y }; });
    if (draft && draft.type === tool && draft.points && draft.points.length) {
      var end = draft.points[draft.points.length - 1];
      if (Math.hypot(end.x - points[0].x, end.y - points[0].y) < uiPx(24, true)) {
        points = draft.points.concat(points.slice(1));
      }
      draft = null;
    }
    storeLine(points, tool, lineMode);
  }

  function commitDraft() {
    if (!draft || !draft.points || draft.points.length < 2) return;
    var points = draft.points.map(function (p) { return { x: p.x, y: p.y }; });
    var type = draft.type || tool;
    draft = null;
    storeLine(points, type, 'straight');
  }

  function addDraftPoint(p) {
    if (!draft || draft.type !== tool) draft = { type: tool, color: currentColor, points: [] };
    draft.color = currentColor;
    var last = draft.points.length ? draft.points[draft.points.length - 1] : null;
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 3) {
      syncChrome();
      requestRedraw();
      return;
    }
    draft.points.push({ x: p.x, y: p.y });
    syncChrome();
    requestRedraw();
  }

  function beginPinch() {
    var pts = Array.from(active.values());
    if (pts.length < 2) return null;
    var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    return {
      dist: dist,
      scale: view.scale,
      ix: (mid.x - view.tx) / view.scale,
      iy: (mid.y - view.ty) / view.scale
    };
  }

  function applyPinch() {
    if (!pinch) return;
    var pts = Array.from(active.values());
    if (pts.length < 2) return;
    var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    var base = containScale();
    var next = clamp(pinch.scale * (dist / pinch.dist), base * 0.5, base * 8);
    view.scale = next;
    view.tx = mid.x - pinch.ix * next;
    view.ty = mid.y - pinch.iy * next;
    requestRedraw();
  }

  function beginGesture(ip) {
    if (!photo) return;
    if (tool === 'select') {
      var hit = hitTest(ip);
      if (!hit) {
        selectedId = null;
        gesture = { mode: 'none' };
        syncChrome();
        requestRedraw();
        return;
      }
      selectedId = hit.id;
      gesture = { mode: 'edit', hit: hit, last: ip, saved: false };
      syncChrome();
      renderList();
      requestRedraw();
      return;
    }
    if (tool === 'scale') {
      gesture = { mode: 'scale', x1: ip.x, y1: ip.y, x2: ip.x, y2: ip.y };
      requestRedraw();
      return;
    }
    if (tool === 'tree') {
      gesture = { mode: 'tree', x1: ip.x, y1: ip.y, x2: ip.x, y2: ip.y };
      requestRedraw();
      return;
    }
    if (tool === 'bush') {
      gesture = { mode: 'bush', cx: ip.x, cy: ip.y, rx: 0, ry: 0 };
      requestRedraw();
      return;
    }
    if (LINE_TOOLS[tool]) {
      gesture = { mode: 'poly', start: { x: ip.x, y: ip.y }, kept: [{ x: ip.x, y: ip.y }], moved: false, cursor: { x: ip.x, y: ip.y } };
    }
  }

  function moveGesture(ip) {
    if (!gesture) return;
    if (gesture.mode === 'edit') {
      var dx = ip.x - gesture.last.x;
      var dy = ip.y - gesture.last.y;
      if (!gesture.saved && Math.hypot(dx, dy) > 0.4) {
        pushUndo();
        gesture.saved = true;
      }
      if (gesture.saved) applyEdit(gesture.hit, ip, dx, dy);
      gesture.last = ip;
      requestRedraw();
      return;
    }
    if (gesture.mode === 'scale' || gesture.mode === 'tree') {
      gesture.x2 = ip.x;
      gesture.y2 = ip.y;
      requestRedraw();
      return;
    }
    if (gesture.mode === 'bush') {
      gesture.rx = Math.abs(ip.x - gesture.cx);
      gesture.ry = Math.abs(ip.y - gesture.cy);
      requestRedraw();
      return;
    }
    if (gesture.mode === 'poly') {
      gesture.cursor = { x: ip.x, y: ip.y };
      if (lineMode === 'freehand') {
        var last = gesture.kept[gesture.kept.length - 1];
        if (Math.hypot(ip.x - last.x, ip.y - last.y) >= 6) gesture.kept.push({ x: ip.x, y: ip.y });
        if (Math.hypot(ip.x - gesture.start.x, ip.y - gesture.start.y) > 8) gesture.moved = true;
      }
      requestRedraw();
    }
  }

  function finishGesture() {
    if (!gesture || gesture.mode === 'none' || gesture.mode === 'edit') {
      if (gesture && gesture.mode === 'edit' && gesture.saved) syncUi();
      return;
    }
    if (gesture.mode === 'scale') {
      var len = Math.hypot(gesture.x2 - gesture.x1, gesture.y2 - gesture.y1);
      var feet = currentRefFeet();
      if (len >= 12 && feet > 0) {
        var tilt = lineTiltDegrees(gesture.x1, gesture.y1, gesture.x2, gesture.y2);
        if (tilt > 10) {
          scaleAttempt = { x1: gesture.x1, y1: gesture.y1, x2: gesture.x2, y2: gesture.y2 };
          $('scaleWarn').classList.remove('hidden');
          $('scaleWarn').textContent = 'That line is tilted. Redo it straight across, from the left edge to the right edge — not corner to corner.';
          tool = 'scale';
          syncUi();
          return;
        }
        pushUndo();
        scaleAttempt = null;
        $('scaleWarn').classList.add('hidden');
        scaleMark = {
          x1: gesture.x1, y1: gesture.y1, x2: gesture.x2, y2: gesture.y2,
          ref: $('scaleRef').value,
          feet: feet
        };
        tool = drawTool;
        syncUi();
      } else if (!(feet > 0)) {
        $('scaleState').textContent = 'Enter the known width first.';
        requestRedraw();
      }
      return;
    }
    if (gesture.mode === 'tree') {
      var tlen = Math.hypot(gesture.x2 - gesture.x1, gesture.y2 - gesture.y1);
      if (tlen >= 16) {
        pushUndo();
        var tree = {
          id: uid(),
          type: 'tree',
          color: currentColor,
          x1: gesture.x1, y1: gesture.y1, x2: gesture.x2, y2: gesture.y2,
          diameterMode: 'auto',
          diameterPx: 18
        };
        elements.push(tree);
        selectedId = tree.id;
        syncUi();
      }
      return;
    }
    if (gesture.mode === 'bush') {
      if (gesture.rx >= 12 && gesture.ry >= 12) {
        pushUndo();
        var bush = {
          id: uid(),
          type: 'bush',
          color: currentColor,
          cx: gesture.cx, cy: gesture.cy, rx: gesture.rx, ry: gesture.ry
        };
        elements.push(bush);
        selectedId = bush.id;
        syncUi();
      }
      return;
    }
    if (gesture.mode === 'poly') {
      if (lineMode === 'freehand') {
        if (gesture.moved) {
          var curved = smoothFreehand(gesture.kept);
          if (curved.length >= 2 && P.polylineLength(curved, false) >= 12) commitPolyline(curved);
        }
        return;
      }
      addDraftPoint(gesture.cursor || gesture.start);
    }
  }

  function onPointerDown(e) {
    if (!photo) return;
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    var cp = clientPoint(e);
    active.set(e.pointerId, cp);
    if (active.size >= 2) {
      gesture = null;
      pinch = beginPinch();
      return;
    }
    beginGesture(imageFromClient(cp));
  }

  function onPointerMove(e) {
    if (!active.has(e.pointerId)) return;
    e.preventDefault();
    active.set(e.pointerId, clientPoint(e));
    if (active.size >= 2) {
      if (!pinch) pinch = beginPinch();
      applyPinch();
      return;
    }
    if (!gesture) return;
    moveGesture(imageFromClient(clientPoint(e)));
  }

  function onPointerUp(e) {
    if (!active.has(e.pointerId)) return;
    active.delete(e.pointerId);
    if (active.size >= 2) {
      pinch = beginPinch();
      return;
    }
    if (active.size === 1) {
      pinch = null;
      gesture = null;
      return;
    }
    var wasPinch = !!pinch;
    pinch = null;
    if (!wasPinch) finishGesture();
    gesture = null;
  }

  function loadHtmlImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('image'));
      };
      img.src = url;
    });
  }

  function fileToCanvas(file) {
    return Promise.resolve().then(function () {
      if (window.createImageBitmap) {
        return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
          return loadHtmlImage(file);
        });
      }
      return loadHtmlImage(file);
    }).then(function (source) {
      var sw = source.width || source.naturalWidth;
      var sh = source.height || source.naturalHeight;
      var maxSide = 1800;
      var sc = Math.min(1, maxSide / Math.max(sw, sh));
      var w = Math.max(1, Math.round(sw * sc));
      var h = Math.max(1, Math.round(sh * sc));
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(source, 0, 0, w, h);
      if (source.close) source.close();
      return { canvas: c, w: w, h: h };
    });
  }

  function onPhoto(file) {
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
      showErr('photoErr', 'Please choose a photo.');
      return;
    }
    if ((elements.length || scaleMark) && !window.confirm('Replace the photo? Your drawing will be cleared.')) return;
    hideErr('photoErr');
    fileToCanvas(file).then(function (decoded) {
      photo = decoded;
      elements = [];
      scaleMark = null;
      draft = null;
      undoStack = [];
      selectedId = null;
      gesture = null;
      $('designer').hidden = false;
      requestAnimationFrame(function () {
        layoutCanvas(true);
        syncUi();
        apiReady = true;
      });
    }).catch(function () {
      showErr('photoErr', 'Couldn’t read that photo. Try a JPG or take a new one.');
    });
  }

  function bindPhoto(input) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) onPhoto(file);
    });
  }

  function canvasJpegFrom(sourceCanvas, maxSide, quality) {
    var sc = Math.min(1, maxSide / Math.max(sourceCanvas.width, sourceCanvas.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sourceCanvas.width * sc));
    c.height = Math.max(1, Math.round(sourceCanvas.height * sc));
    c.getContext('2d').drawImage(sourceCanvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  function exportDesignUrl() {
    var maxSide = 1280;
    var sc = Math.min(1, maxSide / Math.max(photo.w, photo.h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(photo.w * sc));
    c.height = Math.max(1, Math.round(photo.h * sc));
    var ctx = c.getContext('2d');
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    paintScene(ctx, { night: true, interactive: false, forOwner: true });
    var url = c.toDataURL('image/jpeg', 0.68);
    if (url.length > 750000) url = c.toDataURL('image/jpeg', 0.5);
    return url;
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function sheetNotes(est) {
    var parts = [];
    var notes = $('notes').value.trim();
    if (notes) parts.push(notes);
    var refBy = $('referredBy').value.trim();
    if (refBy) parts.push('Referred by: ' + refBy);
    var safe = P.customerView(est);
    if (safe.ready) parts.push('Design estimate ' + safe.range + ' pending review. Measured footage is in the email and design-estimate.txt.');
    return parts.join('\n');
  }

  function showThanks() {
    $('photoCard').classList.add('hidden');
    $('designer').hidden = true;
    $('thanksCard').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function fallbackEmail(subject, name, text, designUrl, originalUrl) {
    var fd = new FormData();
    fd.append('access_key', WEB3FORMS_KEY);
    fd.append('subject', subject);
    fd.append('from_name', name);
    fd.append('message', text);
    try {
      fd.append('attachment', dataUrlToBlob(designUrl), 'design-preview.jpg');
      fd.append('attachment', dataUrlToBlob(originalUrl), 'original.jpg');
    } catch (err) {}
    return fetch('https://api.web3forms.com/submit', { method: 'POST', body: fd }).then(function (res) {
      if (!res.ok) throw new Error('email');
    }).catch(function () {
      return fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: subject,
          from_name: name,
          message: text
        })
      }).catch(function () {});
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    if (sending) return;
    hideErr('formErr');
    if ($('botcheck').checked) {
      showThanks();
      return;
    }
    var first = $('firstName').value.trim();
    var last = $('lastName').value.trim();
    var phone = $('phone').value.trim();
    var street = $('street').value.trim();
    var city = $('city').value.trim();
    var state = ($('state').value.trim() || 'TX').toUpperCase();
    var zip = $('zip').value.trim();
    var email = $('email').value.trim();
    var missing = [];
    if (!photo) missing.push('a photo');
    if (!(pxPerFt() > 0)) missing.push('a scale mark');
    var est = currentEstimate();
    if (!est.ready) missing.push('lights drawn on the photo');
    if (!first || !last) missing.push('first and last name');
    if (!phone) missing.push('a phone number');
    if (!street) missing.push('a street address');
    if (!city) missing.push('a city');
    if (!zip) missing.push('a ZIP code');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) missing.push('a valid email, or leave email blank');
    if (missing.length) {
      showErr('formErr', 'Add ' + missing.join(', ') + '.');
      return;
    }
    sending = true;
    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    var originalUrl = canvasJpegFrom(photo.canvas, 1280, 0.66);
    if (originalUrl.length > 750000) originalUrl = canvasJpegFrom(photo.canvas, 1000, 0.5);
    var designUrl = exportDesignUrl();
    var designPhoto = { name: 'design-preview.jpg', mime: 'image/jpeg', data: designUrl };
    var originalPhoto = { name: 'original.jpg', mime: 'image/jpeg', data: originalUrl };
    var px = pxPerFt();
    var scalePx = scaleMark ? Math.hypot(scaleMark.x2 - scaleMark.x1, scaleMark.y2 - scaleMark.y1) : 0;
    var ownerText = P.ownerReport(est, {
      name: first + ' ' + last,
      phone: phone,
      email: email,
      address: [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(' '),
      notes: $('notes').value.trim(),
      referredBy: $('referredBy').value.trim(),
      scale: { label: currentRefLabel(), feet: scaleMark.feet, px: scalePx, pxPerFt: px }
    });
    var fields = {
      action: 'lead',
      source: 'design form',
      first_name: first,
      last_name: last,
      phone: phone,
      street: street,
      subdivision: '',
      city: city,
      state: state,
      zip: zip,
      email: email,
      notes: sheetNotes(est),
      estimate_low: est.low,
      estimate_high: est.high,
      owner_estimate: ownerText,
      photos: [originalPhoto, designPhoto],
      design_image: designPhoto
    };
    fetch(PROSPECTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(fields),
      redirect: 'follow'
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = JSON.parse(text); } catch (err) {}
        if (!res.ok || data.ok === false) {
          throw new Error((data && data.error) || ('Send failed (' + res.status + ')'));
        }
        return data;
      });
    }).then(function (data) {
      if (data.emailSent === true) return null;
      var text = ownerText;
      if (data.folderUrl) text += '\n\nDrive folder: ' + data.folderUrl;
      text += '\n\nNothing was sent to the customer.';
      return fallbackEmail('+P light design — ' + last + ', ' + first, first + ' ' + last, text, designUrl, originalUrl);
    }).then(function () {
      showThanks();
    }).catch(function (err) {
      showErr('formErr', 'Could not send right now. Try again, or text (214) 995-3002. (' + (err && err.message ? err.message : err) + ')');
      btn.disabled = false;
      btn.textContent = 'Send my design';
      sending = false;
    });
  }

  function expose() {
    window.__plusp = {
      get ready() { return !!(apiReady && photo); },
      screenFromImage: screenFromImage,
      estimate: currentEstimate,
      pricingInput: function () {
        return { pxPerFt: pxPerFt(), tubs: tubCount(), elements: pricingElements() };
      },
      get lineMode() { return lineMode; },
      get elements() { return elements; },
      get view() { return { scale: view.scale, tx: view.tx, ty: view.ty }; }
    };
  }

  function init() {
    if (!P) {
      showErr('photoErr', 'This page did not finish loading. Refresh and try again.');
      return;
    }
    renderColors();
    $('storageHint').textContent = 'Optional storage is $' + P.PRICING.storagePerTubPerYear + ' per tub per year. Leave at 0 if you don’t want storage.';
    updateToolUi();
    bindPhoto($('photoCam'));
    bindPhoto($('photoLib'));
    document.querySelectorAll('.tool').forEach(function (btn) {
      btn.addEventListener('click', function () { setTool(btn.getAttribute('data-tool')); });
    });
    $('modeStraight').addEventListener('click', function () { setLineMode('straight'); });
    $('modeFreehand').addEventListener('click', function () { setLineMode('freehand'); });
    $('quoteForm').addEventListener('focusin', function () {
      formFocused = true;
      updateGuide();
    });
    $('quoteForm').addEventListener('focusout', function () {
      setTimeout(function () {
        var active = document.activeElement;
        formFocused = !!(active && active.closest && active.closest('#quoteForm'));
        updateGuide();
      }, 0);
    });
    $('doneBtn').addEventListener('click', function () { commitDraft(); });
    $('undoBtn').addEventListener('click', undoLast);
    $('deleteBtn').addEventListener('click', deleteSelected);
    $('zoomIn').addEventListener('click', function () { zoomBy(1.25); });
    $('zoomOut').addEventListener('click', function () { zoomBy(1 / 1.25); });
    $('zoomFit').addEventListener('click', fitView);
    $('nightBtn').addEventListener('click', function () {
      night = !night;
      $('nightBtn').classList.toggle('on', night);
      $('nightBtn').setAttribute('aria-pressed', night ? 'true' : 'false');
      $('nightBtn').textContent = night ? 'Night preview on' : 'Night preview';
      requestRedraw();
    });
    $('markScaleBtn').addEventListener('click', function () {
      if (!(currentRefFeet() > 0)) {
        $('scaleState').textContent = 'Enter the known width first.';
        $('customWrap').classList.remove('hidden');
        return;
      }
      setTool('scale');
    });
    $('scaleRef').addEventListener('change', function () {
      var custom = $('scaleRef').value === 'custom';
      $('customWrap').classList.toggle('hidden', !custom);
      if (scaleMark) {
        var feet = currentRefFeet();
        if (feet > 0) {
          pushUndo();
          scaleMark.feet = feet;
          scaleMark.ref = $('scaleRef').value;
          syncUi();
        }
      }
    });
    $('customFeet').addEventListener('input', function () {
      if (!scaleMark || $('scaleRef').value !== 'custom') return;
      var feet = currentRefFeet();
      if (!(feet > 0)) return;
      scaleMark.feet = feet;
      syncUi();
    });
    $('tubMinus').addEventListener('click', function () {
      $('tubs').value = String(Math.max(0, tubCount() - 1));
      syncUi();
    });
    $('tubPlus').addEventListener('click', function () {
      $('tubs').value = String(Math.min(40, tubCount() + 1));
      syncUi();
    });
    $('tubs').addEventListener('input', syncUi);
    $('quoteForm').addEventListener('submit', onSubmit);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
      canvas.addEventListener(name, function (ev) { ev.preventDefault(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
        e.preventDefault();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        undoLast();
        e.preventDefault();
      }
    });
    window.addEventListener('resize', function () {
      if (!photo) return;
      var w = $('stage').clientWidth;
      if (Math.abs(w - lastStageW) < 8) return;
      layoutCanvas(true);
    });
    expose();
  }

  init();
})();
