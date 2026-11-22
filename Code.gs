/**
 * +P Holiday Lighting — Prospects API
 *
 * DEPLOY (keeps the same web app URL the website already posts to)
 * 1. Open the Apps Script project bound to the +P Client Tracker spreadsheet.
 * 2. Open Code.gs, select all, delete, paste this entire file, and save.
 * 3. Deploy → Manage deployments → pencil on the existing Web app →
 *    Version: New version → Deploy.
 *    Do not use New deployment. That would change the URL.
 *    Execute as: Me. Who has access: Anyone.
 *    If you already ran authorizeMailPermission on 11/18, do not run it again.
 *    The first run may ask to view and edit the 2026 +P spreadsheet. Allow it.
 *
 * Quote requests from customer.html and design.html are written to the
 * 2026 +P spreadsheet, Customers tab, first. Columns are matched by the
 * header in row 1. Paid to date, Check, and any formula column are never
 * written. The same lead is then still added to Client Tracker Pipeline
 * and Client List while ALSO_WRITE_CLIENT_TRACKER is true.
 *
 * In 2027: point CUSTOMERS_SHEET_ID at the copied "2027 +P" sheet and
 * set ALSO_WRITE_CLIENT_TRACKER to false.
 *
 * design.html posts action "lead" with the original photo in photos[],
 * plus design_image (JPEG of the lights), owner_estimate, and source
 * "design form". customer.html posts action "lead" without a design image.
 */
// ---------------------------------------------------------------------------
// CONFIG — sheet targets live here so a new year is one edit.
// ---------------------------------------------------------------------------
var CUSTOMERS_SHEET_ID = '1o8i8rO1x763kClQg4YKp01OgPaGWcSW0pphOUu1Evd8'; // 2026 +P
var CUSTOMERS_TAB = 'Customers';
var PROSPECTS_SHEET_ID = '1c4i2baYHHj2Ck8pGkq1ddoTiAC89FF4Jt2AfxbKjIKk'; // +P Client Tracker 2026
var ALSO_WRITE_CLIENT_TRACKER = true;
var LEAD_PHOTOS_FOLDER_ID = '1c2sHhFctt5DU9ZSOOqfB5-plMKeoNyu6';
var QUOTES_FOLDER_ID = '1JPLVPb0qwDYKwaKPu86Hdo3jgQZhrj9x';
var LOGO_FILE_ID = '1idksk7mIhRdB0dpoQ7xc0S5W3bS2i7Un';
var OWNER_EMAIL = 'pluspservices@gmail.com';

var QUOTE_STATUS_CAN_SET_ = { '': 1, 'awaiting quote': 1, 'quoted': 1 };
var US_STATE_BY_NAME_ = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY'
};

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'lead';
    var out;
    if (action === 'lead') out = handleLead(data);
    else if (action === 'saveQuote') out = handleSaveQuote(data);
    else if (action === 'listQuotes') out = handleListQuotes();
    else if (action === 'getQuote') out = handleGetQuote(data);
    else if (action === 'deleteQuote') out = handleDeleteQuote(data);
    else throw new Error('Unknown action: ' + action);
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json_({ ok: true, service: '+P Prospects API', time: new Date().toISOString() });
}

function trackerWritesEnabled_() {
  return ALSO_WRITE_CLIENT_TRACKER !== false;
}

function sheet_() {
  var ss = SpreadsheetApp.openById(PROSPECTS_SHEET_ID);
  return ss.getSheetByName('Pipeline') || ss.getSheets()[0];
}

function customersSheet_() {
  var ss = SpreadsheetApp.openById(CUSTOMERS_SHEET_ID);
  var sh = ss.getSheetByName(CUSTOMERS_TAB);
  if (!sh) throw new Error('Customers tab not found on 2026 +P');
  return sh;
}

function handleLead(data) {
  var first = clean_(data.first_name);
  var last = clean_(data.last_name);
  var parsed = splitStreetAddress_(data.street, data.city, data.state, data.zip);
  var street = parsed.street;
  var city = parsed.city;
  var state = parsed.state || 'TX';
  var zip = parsed.zip;
  var phone = clean_(data.phone);
  var email = clean_(data.email);
  var subdivision = clean_(data.subdivision);
  var notes = clean_(data.notes);
  var photos = data.photos || [];
  if (!first || !last || !phone || !street) throw new Error('Missing required fields');

  var id = Utilities.getUuid().slice(0, 8);
  var stamp = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm');
  var folderName = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd') + ' ' + last + ', ' + first + ' — ' + street + (city ? (' ' + city) : '');
  folderName = folderName.substring(0, 120);

  var parent = DriveApp.getFolderById(LEAD_PHOTOS_FOLDER_ID);
  var folder = parent.createFolder(folderName);
  var saved = 0;
  var attached = 0;
  var designSaveError = '';
  var skipNamedDesign = !!(data.design_image && data.design_image.data);
  for (var i = 0; i < photos.length && i < 8; i++) {
    var p = photos[i];
    if (!p || !p.data) continue;
    if (skipNamedDesign && isDesignPhoto_(p)) continue;
    attached++;
    try {
      folder.createFile(imageBlob_(p, 'photo-' + (saved + 1) + '.jpg'));
      saved++;
    } catch (imgErr) {
      if (!designSaveError) designSaveError = String(imgErr && imgErr.message ? imgErr.message : imgErr);
    }
  }
  if (skipNamedDesign) {
    attached++;
    try {
      folder.createFile(imageBlob_(data.design_image, 'design-preview.jpg'));
      saved++;
    } catch (imgErr2) {
      designSaveError = String(imgErr2 && imgErr2.message ? imgErr2.message : imgErr2);
    }
  }

  var estimateText = clean_(data.owner_estimate);
  if (estimateText) {
    try {
      replaceNamedFile_(folder, 'design-estimate.txt', Utilities.newBlob(estimateText, 'text/plain', 'design-estimate.txt'));
    } catch (fileErr) {}
  }

  var wantsDesignMail = skipNamedDesign || !!estimateText || clean_(data.source) === 'design form';
  var emailSent = false;
  var emailError = '';
  if (wantsDesignMail) {
    try {
      sendDesignEmail_(data, folder, estimateText, saved);
      emailSent = true;
    } catch (mailErr) {
      emailError = String(mailErr && mailErr.message ? mailErr.message : mailErr);
    }
  }

  var lead = {
    id: id,
    stamp: stamp,
    first: first,
    last: last,
    phone: phone,
    rawStreet: clean_(data.street),
    street: street,
    city: city,
    state: state,
    zip: zip,
    email: email,
    subdivision: subdivision,
    notes: notes,
    source: clean_(data.source) || 'customer form',
    folderUrl: folder.getUrl(),
    photoCount: saved,
    estimateLow: estimateLowCell_(data)
  };

  var testSkipped = isTestLead_(lead);
  var customersWrote = false;
  var customersError = '';
  var customerRow = 0;
  var deduped = false;
  if (!testSkipped) {
    try {
      var customerPlan = planCustomerLead_(readSheetGrid_(customersSheet_()), lead);
      if (customerPlan.action === 'error') throw new Error(customerPlan.error || 'Customers write failed');
      if (customerPlan.action === 'append' || customerPlan.action === 'update') {
        setPlannedCells_(customersSheet_(), customerPlan.row, customerPlan.writes);
        customersWrote = true;
        customerRow = customerPlan.row;
        deduped = !!customerPlan.deduped;
        if (customerPlan.leadId) {
          id = customerPlan.leadId;
          lead.id = id;
        }
      }
    } catch (custErr) {
      customersError = String(custErr && custErr.message ? custErr.message : custErr);
    }
  }

  var pipelineError = '';
  var clientListError = '';
  var trackerWrote = false;
  var trackerAttempted = false;
  if (trackerWritesEnabled_()) {
    trackerAttempted = true;
    try {
      var pipelineSheet = sheet_();
      var pipelinePlan = planPipelineLead_(pipelineSheet.getDataRange().getValues(), lead);
      writePipelinePlan_(pipelineSheet, pipelinePlan);
      trackerWrote = true;
      if (pipelinePlan.values && clean_(pipelinePlan.values[0])) id = clean_(pipelinePlan.values[0]);
    } catch (pipeErr) {
      pipelineError = String(pipeErr && pipeErr.message ? pipeErr.message : pipeErr);
    }
    try {
      var listSheet = clientListSheet_();
      var listPlan = planClientListLead_(listSheet.getDataRange().getValues(), lead);
      writeClientListPlan_(listSheet, listPlan);
      trackerWrote = true;
    } catch (listErr) {
      clientListError = String(listErr && listErr.message ? listErr.message : listErr);
    }
  }

  var result = buildLeadResponse_({
    saved: saved,
    attached: attached,
    customersWrote: customersWrote,
    customersError: customersError,
    trackerWrote: trackerWrote,
    trackerAttempted: trackerAttempted,
    trackerOff: !trackerWritesEnabled_(),
    testSkipped: testSkipped,
    pipelineError: pipelineError,
    clientListError: clientListError
  });
  result.prospectId = id;
  result.folderUrl = folder.getUrl();
  result.sheetUrl = 'https://docs.google.com/spreadsheets/d/' + CUSTOMERS_SHEET_ID + '/edit';
  result.trackerUrl = 'https://docs.google.com/spreadsheets/d/' + PROSPECTS_SHEET_ID + '/edit';
  result.emailSent = emailSent;
  result.emailError = emailError;
  result.designSaveError = designSaveError;
  result.customerRow = customerRow;
  result.deduped = deduped;
  return result;
}

function buildLeadResponse_(o) {
  o = o || {};
  var saved = Number(o.saved) || 0;
  var attached = Number(o.attached) || 0;
  var photosFailed = attached > 0 && saved === 0;
  var customersError = o.customersError || '';
  var pipelineError = o.pipelineError || '';
  var clientListError = o.clientListError || '';
  var stored = !!(o.customersWrote || o.trackerWrote);
  var ok;
  if (o.testSkipped) {
    if (o.trackerOff || !o.trackerAttempted) ok = true;
    else ok = !!o.trackerWrote;
  } else {
    ok = stored;
  }
  var status = 'ok';
  if (!ok) status = 'error';
  else if (photosFailed || customersError || pipelineError || clientListError) status = 'partial';
  var error = '';
  if (!ok) error = customersError || pipelineError || clientListError || 'Could not save the lead.';
  else if (photosFailed) error = 'Photos were attached but none saved to Drive.';
  return {
    ok: ok,
    status: status,
    error: error,
    photosFailed: photosFailed,
    photoCount: saved,
    attachedPhotoCount: attached,
    testSkipped: !!o.testSkipped,
    customersError: customersError,
    pipelineError: pipelineError,
    clientListError: clientListError
  };
}

function readSheetGrid_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var headerRange = sheet.getRange(1, 1, 1, lastCol);
  var headers = headerRange.getValues()[0];
  var headerFormulas = headerRange.getFormulas()[0];
  var values = [];
  var formulas = [];
  var formulasRow2 = [];
  if (lastRow >= 2) {
    var num = lastRow - 1;
    var body = sheet.getRange(2, 1, num, lastCol);
    values = body.getValues();
    formulas = body.getFormulas();
    formulasRow2 = formulas[0] || [];
  }
  return {
    headers: headers,
    headerFormulas: headerFormulas,
    formulasRow2: formulasRow2,
    values: values,
    formulas: formulas
  };
}

function customerColumnBlocked_(grid) {
  var blocked = [];
  for (var i = 0; i < grid.headers.length; i++) {
    var name = clean_(grid.headers[i]).toLowerCase();
    var headerFormula = grid.headerFormulas && grid.headerFormulas[i] ? String(grid.headerFormulas[i]) : '';
    var topFormula = grid.formulasRow2 && grid.formulasRow2[i] ? String(grid.formulasRow2[i]) : '';
    // A single formula in a notes cell only protects that cell. An ARRAYFORMULA
    // in row 2 (Paid to date and Check) protects the whole column, including
    // the blank rows it spills into.
    blocked[i] = name === 'paid to date' || name === 'check' || headerFormula.indexOf('=') === 0 || topFormula.indexOf('ARRAYFORMULA') !== -1;
  }
  return blocked;
}

function customerHeaderMap_(grid) {
  var blocked = customerColumnBlocked_(grid);
  grid.blocked = blocked;
  var map = {};
  for (var i = 0; i < grid.headers.length; i++) {
    if (blocked[i]) continue;
    var name = clean_(grid.headers[i]).toLowerCase();
    if (!name) continue;
    map[name] = i;
    if (name === 'first name') map.first = i;
    else if (name === 'last name') map.last = i;
    else if (name === 'phone number') map.phone = i;
    else if (name === 'zip code' || name === 'postal code') map.zip = i;
    else if (name === 'photo folder') map['photos folder'] = i;
    else if (name === 'e-mail' || name === 'e mail') map.email = i;
  }
  return map;
}

function cellBlocked_(grid, rowIndex, colIndex) {
  if (colIndex == null || colIndex < 0) return true;
  if (grid.blocked && grid.blocked[colIndex]) return true;
  if (rowIndex >= 0 && grid.formulas && grid.formulas[rowIndex] && String(grid.formulas[rowIndex][colIndex] || '').indexOf('=') === 0) return true;
  return false;
}

function customerRowOccupied_(row, map) {
  // A–E on Customers are First, Last, Status, Phone, Address. Any of those
  // marks a real row. Formula spills in Paid to date / Check sit in K and L
  // and must not push the next lead past the last person.
  var limit = Math.min(5, row.length);
  var c;
  for (c = 0; c < limit; c++) {
    if (clean_(row[c])) return true;
  }
  if (!map) return false;
  if (map.first != null && map.first >= 5 && clean_(row[map.first])) return true;
  if (map.last != null && map.last >= 5 && clean_(row[map.last])) return true;
  if (map.address != null && map.address >= 5 && clean_(row[map.address])) return true;
  return false;
}

function nextCustomerSheetRow_(grid, map) {
  var last = 1;
  for (var r = 0; r < grid.values.length; r++) {
    if (customerRowOccupied_(grid.values[r], map)) last = r + 2;
  }
  return last + 1;
}

function findValueRowByPhone_(values, col, phone) {
  var want = normalizePhoneDigits_(phone);
  if (!want || col == null || col < 0) return -1;
  for (var r = 0; r < values.length; r++) {
    if (normalizePhoneDigits_(values[r][col]) === want) return r;
  }
  return -1;
}

function findValueRowByAddress_(values, col, street) {
  var want = normAddr_(street);
  if (!want || col == null || col < 0) return -1;
  for (var r = 0; r < values.length; r++) {
    if (normAddr_(values[r][col]) === want) return r;
  }
  return -1;
}

function leadNotesForCustomer_(lead, mentionSubdivision, extraFolder) {
  var parts = [];
  if (clean_(lead.notes)) parts.push(clean_(lead.notes));
  if (mentionSubdivision && clean_(lead.subdivision)) parts.push('Subdivision: ' + clean_(lead.subdivision));
  if (lead.state && String(lead.state).toUpperCase() !== 'TX') parts.push('State: ' + String(lead.state).toUpperCase());
  if (extraFolder) parts.push('Photos folder: ' + extraFolder);
  return parts.join('\n');
}

function planCustomerLead_(grid, lead) {
  if (isTestLead_(lead)) return { action: 'skip', testSkipped: true, writes: [], row: 0, deduped: false, leadId: lead.id || '' };
  var map = customerHeaderMap_(grid);
  if (map.first == null || map.phone == null) {
    return { action: 'error', error: 'Customers tab is missing First or Phone', writes: [] };
  }
  var existing = findValueRowByPhone_(grid.values, map.phone, lead.phone);
  var deduped = existing >= 0;
  var rowIndex = deduped ? existing : -1;
  var sheetRow = deduped ? existing + 2 : nextCustomerSheetRow_(grid, map);
  var rowValues = deduped ? grid.values[rowIndex] : null;
  var writes = [];
  function put(key, value, mode) {
    var col = map[key];
    if (col == null) return;
    if (cellBlocked_(grid, rowIndex, col)) return;
    if (value == null || clean_(value) === '') return;
    var existingVal = rowValues ? rowValues[col] : '';
    if (mode === 'append') {
      var merged = appendNote_(existingVal, value);
      if (merged === clean_(existingVal)) return;
      writes.push({ col: col + 1, value: merged });
      return;
    }
    if (clean_(existingVal)) return;
    writes.push({ col: col + 1, value: value });
  }
  put('status', 'Awaiting Quote', 'fill');
  put('first', lead.first, 'fill');
  put('last', lead.last, 'fill');
  put('phone', phoneWithDots_(lead.phone), 'fill');
  put('address', lead.street, 'fill');
  put('city / area', cityArea_(lead.city, lead.subdivision), 'fill');
  put('email', lead.email, 'fill');
  put('zip', lead.zip, 'fill');
  put('lead date', lead.stamp, 'fill');
  put('source', lead.source, 'fill');
  put('photos folder', lead.folderUrl, 'fill');
  put('lead id', lead.id, 'fill');
  var areaCol = map['city / area'];
  var folderCol = map['photos folder'];
  var existingArea = rowValues && areaCol != null ? clean_(rowValues[areaCol]) : '';
  var existingFolder = rowValues && folderCol != null ? clean_(rowValues[folderCol]) : '';
  var sub = clean_(lead.subdivision);
  var mentionSub = !!(sub && (areaCol == null || (existingArea && existingArea.toLowerCase().indexOf(sub.toLowerCase()) === -1)));
  var extraFolder = '';
  if (lead.folderUrl && existingFolder && existingFolder !== clean_(lead.folderUrl)) extraFolder = lead.folderUrl;
  put('notes', leadNotesForCustomer_(lead, mentionSub, extraFolder), 'append');
  var leadId = lead.id || '';
  if (deduped && map['lead id'] != null && clean_(rowValues[map['lead id']])) leadId = clean_(rowValues[map['lead id']]);
  return {
    action: deduped ? 'update' : 'append',
    row: sheetRow,
    writes: writes,
    deduped: deduped,
    leadId: leadId,
    testSkipped: false
  };
}

function quoteEstimateValue_(v) {
  if (v == null || v === '') return '';
  var n = Number(v);
  if (!isFinite(n) || n === 0) return '';
  return n;
}

function planCustomerQuote_(grid, quote) {
  var map = customerHeaderMap_(grid);
  var rowIndex = findValueRowByPhone_(grid.values, map.phone, quote.phone);
  if (rowIndex < 0) rowIndex = findValueRowByAddress_(grid.values, map.address, quote.street);
  if (rowIndex < 0) return { action: 'none', writes: [], row: 0 };
  var rowValues = grid.values[rowIndex];
  var writes = [];
  function put(key, value, onlyBlank) {
    var col = map[key];
    if (col == null) return;
    if (cellBlocked_(grid, rowIndex, col)) return;
    if (value == null || clean_(value) === '') return;
    if (onlyBlank && clean_(rowValues[col])) return;
    writes.push({ col: col + 1, value: value });
  }
  if (map.status != null && !cellBlocked_(grid, rowIndex, map.status)) {
    var current = clean_(rowValues[map.status]).toLowerCase();
    if (QUOTE_STATUS_CAN_SET_[current]) writes.push({ col: map.status + 1, value: 'Quoted' });
  }
  put('my estimate', quoteEstimateValue_(quote.estimate), true);
  put('estimate doc', quote.docUrl, false);
  return { action: writes.length ? 'update' : 'none', row: rowIndex + 2, writes: writes };
}

function setPlannedCells_(sheet, row, writes) {
  writes = writes || [];
  for (var i = 0; i < writes.length; i++) {
    var col = writes[i].col;
    var range = sheet.getRange(row, col);
    var formula = '';
    try { formula = range.getFormula(); } catch (e) {}
    if (formula && String(formula).indexOf('=') === 0) continue;
    if (row !== 2) {
      var top = '';
      try { top = sheet.getRange(2, col).getFormula(); } catch (e2) {}
      if (top && String(top).indexOf('ARRAYFORMULA') !== -1) continue;
    }
    range.setValue(writes[i].value);
  }
}

function headerCol_(header, names, fallback) {
  if (header) {
    for (var i = 0; i < header.length; i++) {
      var n = clean_(header[i]).toLowerCase();
      for (var j = 0; j < names.length; j++) {
        if (n === names[j]) return i;
      }
    }
  }
  return fallback;
}

function blankCell_(value) {
  return clean_(value) === '';
}

function planPipelineLead_(rows, lead) {
  rows = rows || [];
  var header = rows[0] || [];
  var phoneCol = headerCol_(header, ['phone'], 5);
  var found = findValueRowByPhone_(rows.slice(1), phoneCol, lead.phone);
  var phoneDisplay = phoneWithDots_(lead.phone);
  if (found < 0) {
    return {
      action: 'append',
      row: rows.length + 1,
      values: [
        lead.id, lead.stamp, 'New lead', lead.first, lead.last, phoneDisplay, lead.email,
        lead.street, lead.subdivision, lead.city, lead.state || 'TX', lead.zip,
        lead.notes, lead.photoCount, lead.folderUrl,
        (lead.estimateLow === 0 || lead.estimateLow) ? lead.estimateLow : '',
        '', '', lead.stamp, lead.source || 'customer form'
      ]
    };
  }
  var src = rows[found + 1] || [];
  var prev = [];
  var width = Math.max(src.length, 21);
  for (var c = 0; c < width; c++) prev[c] = src[c] != null ? src[c] : '';
  function fill(i, value) {
    if (value == null || clean_(value) === '') return;
    if (!blankCell_(prev[i])) return;
    prev[i] = value;
  }
  fill(0, lead.id);
  if (blankCell_(prev[2])) prev[2] = 'New lead';
  fill(3, lead.first);
  fill(4, lead.last);
  fill(5, phoneDisplay);
  fill(6, lead.email);
  fill(7, lead.street);
  fill(8, lead.subdivision);
  fill(9, lead.city);
  fill(10, lead.state);
  fill(11, lead.zip);
  var notesCol = headerCol_(header, ['notes'], 12);
  prev[notesCol] = appendNote_(prev[notesCol], lead.notes);
  var folderCol = headerCol_(header, ['photos folder'], 14);
  if (lead.folderUrl && !blankCell_(prev[folderCol]) && clean_(prev[folderCol]) !== clean_(lead.folderUrl)) {
    prev[notesCol] = appendNote_(prev[notesCol], 'Photos folder: ' + lead.folderUrl);
  } else {
    fill(folderCol, lead.folderUrl);
  }
  var photoCountCol = headerCol_(header, ['photos'], 13);
  if ((blankCell_(prev[photoCountCol]) || Number(prev[photoCountCol]) === 0) && lead.photoCount) prev[photoCountCol] = lead.photoCount;
  if ((lead.estimateLow === 0 || (lead.estimateLow != null && lead.estimateLow !== '')) && blankCell_(prev[15])) prev[15] = lead.estimateLow;
  prev[18] = lead.stamp;
  fill(19, lead.source);
  return { action: 'update', row: found + 2, values: prev };
}

function planClientListLead_(rows, lead) {
  rows = rows || [];
  var header = rows[0] || [];
  var phoneCol = headerCol_(header, ['phone', 'phone number'], 3);
  var found = findValueRowByPhone_(rows.slice(1), phoneCol, lead.phone);
  var parts = splitStreet_(lead.street);
  var phoneDisplay = phoneWithDots_(lead.phone);
  if (found < 0) {
    return {
      action: 'append',
      row: rows.length + 1,
      values: ['Awaiting Quote', lead.first, lead.last, phoneDisplay, parts.number, parts.name, lead.city]
    };
  }
  var src = rows[found + 1] || [];
  var notesCol = headerCol_(header, ['notes'], 12);
  var width = Math.max(src.length, notesCol + 1, 7);
  var prev = [];
  for (var c = 0; c < width; c++) prev[c] = src[c] != null ? src[c] : '';
  function fill(i, value) {
    if (value == null || clean_(value) === '') return;
    if (!blankCell_(prev[i])) return;
    prev[i] = value;
  }
  fill(0, 'Awaiting Quote');
  fill(1, lead.first);
  fill(2, lead.last);
  fill(3, phoneDisplay);
  fill(4, parts.number);
  fill(5, parts.name);
  fill(6, lead.city);
  if (clean_(lead.notes)) prev[notesCol] = appendNote_(prev[notesCol], lead.notes);
  return { action: 'update', row: found + 2, values: prev };
}

function valuesLookSame_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a == null ? '' : a) === String(b == null ? '' : b);
}

function writeMergedRow_(sheet, row, values) {
  for (var i = 0; i < values.length; i++) {
    var range = sheet.getRange(row, i + 1);
    var formula = '';
    try { formula = range.getFormula(); } catch (e) {}
    if (formula && String(formula).indexOf('=') === 0) continue;
    var next = values[i] == null ? '' : values[i];
    var current;
    try { current = range.getValue(); } catch (e2) { current = ''; }
    if (valuesLookSame_(current, next)) continue;
    if (clean_(next) === '' && clean_(current) !== '') continue;
    range.setValue(next);
  }
}

function writePipelinePlan_(sheet, plan) {
  if (!plan) return;
  if (plan.action === 'append') {
    sheet.appendRow(plan.values);
    return;
  }
  writeMergedRow_(sheet, plan.row, plan.values);
}

function writeClientListPlan_(sheet, plan) {
  if (!plan) return;
  if (plan.action === 'append') {
    sheet.appendRow(plan.values);
    return;
  }
  writeMergedRow_(sheet, plan.row, plan.values);
}

function clientListSheet_() {
  var ss = SpreadsheetApp.openById(PROSPECTS_SHEET_ID);
  var sh = ss.getSheetByName('Client List');
  if (!sh) throw new Error('Client List tab not found on +P Client Tracker');
  return sh;
}

function splitStreet_(street) {
  var s = clean_(street);
  var m = s.match(/^(\d+)\s+([\s\S]+)$/);
  if (!m) return { number: '', name: s };
  return { number: m[1], name: clean_(m[2]) };
}

function isStreetSuffix_(word) {
  var w = clean_(word).toLowerCase().replace(/\./g, '');
  var suffixes = {
    st: 1, street: 1, ave: 1, avenue: 1, rd: 1, road: 1, dr: 1, drive: 1,
    ln: 1, lane: 1, ct: 1, court: 1, blvd: 1, boulevard: 1, way: 1, pl: 1,
    place: 1, cir: 1, circle: 1, ter: 1, terrace: 1, pkwy: 1, parkway: 1,
    trl: 1, trail: 1, hwy: 1, highway: 1, cv: 1, cove: 1, loop: 1, pass: 1,
    path: 1, run: 1, row: 1, sq: 1, square: 1
  };
  return !!suffixes[w];
}

function normalizeState_(raw) {
  var s = clean_(raw).replace(/\./g, '');
  if (!s) return '';
  var lower = s.toLowerCase();
  if (US_STATE_BY_NAME_[lower]) return US_STATE_BY_NAME_[lower];
  if (/^[A-Za-z]{2}$/.test(s)) {
    var code = s.toUpperCase();
    var names = US_STATE_BY_NAME_;
    for (var key in names) {
      if (names[key] === code) return code;
    }
  }
  return '';
}

function peelStreetTail_(raw) {
  var s = clean_(raw).replace(/\s+/g, ' ');
  if (!s) return null;
  var zip = '';
  var zipMatch = s.match(/^(.*?)[,\s]+(\d{5})(?:-\d{4})?$/);
  if (zipMatch) {
    zip = zipMatch[2];
    s = clean_(zipMatch[1]).replace(/[,\s]+$/, '');
  }
  var state = '';
  var commaAt = s.lastIndexOf(',');
  if (commaAt !== -1) {
    var tail = clean_(s.slice(commaAt + 1));
    var stComma = normalizeState_(tail);
    if (stComma) {
      state = stComma;
      s = clean_(s.slice(0, commaAt));
    }
  }
  if (!state) {
    // Last word only. A spaced name like "Plano TX" must not be read as one state.
    var stateWord = s.match(/^(.*\S)[,\s]+([A-Za-z]{2,})$/);
    if (stateWord) {
      var stWord = normalizeState_(stateWord[2]);
      if (stWord) {
        state = stWord;
        s = clean_(stateWord[1]);
      }
    }
  }
  if (!zip && !state) return null;
  var street = s;
  var city = '';
  var comma = s.lastIndexOf(',');
  if (comma !== -1) {
    street = clean_(s.slice(0, comma));
    city = clean_(s.slice(comma + 1));
  } else {
    var sp = s.match(/^(.*\d.*\S)\s+([A-Za-z][A-Za-z.'\-]+)$/);
    if (sp && !isStreetSuffix_(sp[2])) {
      street = clean_(sp[1]);
      city = clean_(sp[2]);
    }
  }
  if (!street) return null;
  return { street: street, city: city, state: state, zip: zip };
}

function splitStreetAddress_(street, city, state, zip) {
  var explicitState = normalizeState_(state);
  var zipMatch = String(zip == null ? '' : zip).match(/\d{5}/);
  var out = {
    street: clean_(street).replace(/\s+/g, ' '),
    city: clean_(city),
    state: explicitState || 'TX',
    zip: zipMatch ? zipMatch[0] : ''
  };
  var peeled = peelStreetTail_(street);
  if (!peeled) return out;
  out.street = peeled.street;
  if (!out.city && peeled.city) out.city = peeled.city;
  if (!out.zip && peeled.zip) out.zip = peeled.zip;
  if (peeled.state && (!explicitState || (explicitState === 'TX' && peeled.state !== 'TX'))) out.state = peeled.state;
  return out;
}

function normalizePhoneDigits_(phone) {
  var d = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.substring(1);
  return d;
}

function normalizePhone_(v) {
  return normalizePhoneDigits_(v);
}

function phoneWithDots_(phone) {
  var d = normalizePhoneDigits_(phone);
  if (d.length === 10) return d.substring(0, 3) + '.' + d.substring(3, 6) + '.' + d.substring(6);
  return clean_(phone);
}

function isTestLead_(lead) {
  lead = lead || {};
  var name = (clean_(lead.first) + ' ' + clean_(lead.last)).toLowerCase();
  if (name.indexOf('lightingbot') !== -1) return true;
  if (name.indexOf('test') !== -1) return true;
  var street = (clean_(lead.rawStreet) + ' ' + clean_(lead.street)).toLowerCase();
  if (street.indexOf('6040') !== -1 && street.indexOf('oakmere') !== -1) return true;
  if (normalizePhoneDigits_(lead.phone) === '2149953002') return true;
  return false;
}

function cityArea_(city, subdivision) {
  city = clean_(city);
  subdivision = clean_(subdivision);
  if (city && subdivision && city.toLowerCase() !== subdivision.toLowerCase()) return city + ' / ' + subdivision;
  return city || subdivision || '';
}

function appendNote_(existing, extra) {
  var cur = clean_(existing);
  var add = clean_(extra);
  if (!add) return cur;
  if (!cur) return add;
  if (cur.indexOf(add) !== -1) return cur;
  return cur + '\n' + add;
}

function normAddr_(v) {
  return clean_(v).toLowerCase().replace(/[#.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function estimateLowCell_(data) {
  if (!data) return '';
  if (data.estimate_low === 0 || (data.estimate_low != null && data.estimate_low !== '' && !isNaN(Number(data.estimate_low)))) {
    return Number(data.estimate_low);
  }
  return '';
}

function isDesignPhoto_(p) {
  var n = String(p && p.name || '').toLowerCase();
  return n === 'design-preview.jpg' || n === 'design-preview.jpeg';
}

function imageBlob_(photo, fallbackName) {
  var bytes = Utilities.base64Decode(String(photo.data).replace(/^data:image\/[a-zA-Z+]+;base64,/, ''));
  var name = photo.name || fallbackName || 'photo.jpg';
  return Utilities.newBlob(bytes, photo.mime || 'image/jpeg', name);
}

function sendDesignEmail_(data, folder, estimateText, savedCount) {
  var first = clean_(data.first_name);
  var last = clean_(data.last_name);
  var subject = '+P light design — ' + last + ', ' + first;
  var street = clean_(data.street);
  if (street) subject += ' — ' + street;
  subject = subject.substring(0, 180);
  var body = estimateText || 'New light design lead.';
  if (body.length > 18000) body = body.substring(0, 18000) + '\n…(truncated)';
  body += '\n\nPhotos saved to Drive: ' + (savedCount == null ? 0 : savedCount);
  body += '\nDrive folder: ' + folder.getUrl();
  body += '\nCustomers: https://docs.google.com/spreadsheets/d/' + CUSTOMERS_SHEET_ID + '/edit';
  body += '\nTracker: https://docs.google.com/spreadsheets/d/' + PROSPECTS_SHEET_ID + '/edit';
  body += '\n\nNothing was emailed to the customer. Review the design, then text them a final quote.';
  var attachments = [];
  if (data.design_image && data.design_image.data) {
    attachments.push(imageBlob_(data.design_image, 'design-preview.jpg'));
  }
  var photos = data.photos || [];
  for (var i = 0; i < photos.length && attachments.length < 5; i++) {
    if (!photos[i] || !photos[i].data) continue;
    if (isDesignPhoto_(photos[i]) && data.design_image && data.design_image.data) continue;
    attachments.push(imageBlob_(photos[i], 'photo-' + (i + 1) + '.jpg'));
  }
  var mail = {
    to: OWNER_EMAIL,
    subject: subject,
    body: body,
    attachments: attachments
  };
  var reply = clean_(data.email);
  if (reply) mail.replyTo = reply;
  MailApp.sendEmail(mail);
}

/** Run once from the editor (Run ▶) to grant "Send email as you", then redeploy. */
function authorizeMailPermission() {
  MailApp.sendEmail(OWNER_EMAIL, '+P mail permission check', 'Apps Script can email design leads to this inbox. You can ignore this message.');
}

function findRowById_(rows, id) {
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][0]) === String(id)) return r + 1;
  }
  return -1;
}

function findRowByPhoneStreet_(rows, phone, street) {
  var p = normalizePhone_(phone);
  var s = clean_(street).toLowerCase();
  if (!p || !s) return -1;
  for (var r = 1; r < rows.length; r++) {
    if (normalizePhone_(rows[r][5]) === p && clean_(rows[r][7]).toLowerCase() === s) return r + 1;
  }
  return -1;
}

function handleSaveQuote(data) {
  var sheet = sheet_();
  var rows = sheet.getDataRange().getValues();
  var id = clean_(data.prospectId);
  var stamp = Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm');
  var first = clean_(data.first_name);
  var last = clean_(data.last_name);
  var street = clean_(data.street);
  var phone = clean_(data.phone);

  var found = id ? findRowById_(rows, id) : -1;
  if (found < 0) found = findRowByPhoneStreet_(rows, phone, street);
  if (found > 0 && !id) id = String(rows[found - 1][0] || '');
  if (!id) id = Utilities.getUuid().slice(0, 8);

  var parent = DriveApp.getFolderById(QUOTES_FOLDER_ID);
  var folder = null;
  var prevDocUrl = '';
  if (found > 0) {
    prevDocUrl = clean_(rows[found - 1][20]);
    folder = folderFromUrl_(rows[found - 1][17]);
  }
  if (!folder) {
    var folderName = 'Estimate ' + last + ', ' + first + ' — ' + street;
    folderName = folderName.substring(0, 120);
    folder = parent.createFolder(folderName);
  }

  var snap = data.quote_json || null;
  if (snap) {
    replaceNamedFile_(folder, '_reload-data.json', Utilities.newBlob(JSON.stringify(snap, null, 2), 'application/json', '_reload-data.json'));
    trashNamedFiles_(folder, 'quote.json');
  }
  if (data.pdf_base64) {
    var pdfBytes = Utilities.base64Decode(String(data.pdf_base64).replace(/^data:application\/pdf;base64,/, ''));
    replaceNamedFile_(folder, 'Estimate.pdf', Utilities.newBlob(pdfBytes, 'application/pdf', 'Estimate.pdf'));
  }
  var docUrl = writeEstimateDoc_(folder, data, snap, stamp, prevDocUrl);

  var status = clean_(data.status) || 'Estimate saved';
  var row = [
    id, stamp, status, first, last,
    phone, clean_(data.email), street, clean_(data.subdivision),
    clean_(data.city), clean_(data.state) || 'TX', clean_(data.zip), clean_(data.notes),
    '', '', data.first_hang_total || '', data.rehang_total || '', folder.getUrl(), stamp, 'estimate app', docUrl || ''
  ];

  if (found > 0) {
    var prev = rows[found - 1];
    row[1] = prev[1] || stamp;
    if (!clean_(data.status) && prev[2]) row[2] = prev[2];
    if (status === 'Estimate saved' && prev[2] && String(prev[2]).indexOf('New') === 0) row[2] = 'Quoted';
    row[13] = prev[13];
    row[14] = prev[14];
    if (!row[6] && prev[6]) row[6] = prev[6];
    sheet.getRange(found, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  var customersUpdated = false;
  var customersError = '';
  var customerRow = 0;
  try {
    var parsedAddr = splitStreetAddress_(street, data.city, data.state, data.zip);
    var quotePlan = planCustomerQuote_(readSheetGrid_(customersSheet_()), {
      phone: phone,
      street: parsedAddr.street || street,
      estimate: data.first_hang_total,
      docUrl: docUrl || ''
    });
    if (quotePlan.action === 'update') {
      setPlannedCells_(customersSheet_(), quotePlan.row, quotePlan.writes);
      customersUpdated = true;
      customerRow = quotePlan.row;
    }
  } catch (quoteCustomerErr) {
    customersError = String(quoteCustomerErr && quoteCustomerErr.message ? quoteCustomerErr.message : quoteCustomerErr);
  }

  return {
    ok: true,
    prospectId: id,
    folderUrl: folder.getUrl(),
    docUrl: docUrl || folder.getUrl(),
    customersUpdated: customersUpdated,
    customersError: customersError,
    customerRow: customerRow
  };
}

function rowToProspect_(r) {
  return {
    prospectId: r[0],
    date: r[1],
    status: r[2],
    first_name: r[3],
    last_name: r[4],
    phone: r[5],
    email: r[6],
    street: r[7],
    subdivision: r[8],
    city: r[9],
    state: r[10],
    zip: r[11],
    notes: r[12],
    photo_count: r[13],
    photo_folder_url: r[14],
    first_hang_total: r[15],
    rehang_total: r[16],
    estimate_folder_url: r[17],
    last_updated: r[18],
    source: r[19],
    estimate_doc_url: r[20] || ''
  };
}

function handleListQuotes() {
  var sheet = sheet_();
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push(rowToProspect_(rows[i]));
  }
  return { ok: true, prospects: out };
}

function readQuoteJsonFromFolder_(folderUrl) {
  if (!folderUrl) return null;
  try {
    var idMatch = String(folderUrl).match(/[-\w]{25,}/);
    if (!idMatch) return null;
    var folder = DriveApp.getFolderById(idMatch[0]);
    var files = folder.getFilesByName('_reload-data.json');
    if (!files.hasNext()) files = folder.getFilesByName('quote.json');
    if (!files.hasNext()) return null;
    var text = files.next().getBlob().getDataAsString();
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function handleGetQuote(data) {
  var id = clean_(data.prospectId);
  var list = handleListQuotes().prospects || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].prospectId) === id) {
      var p = list[i];
      p.quote_json = readQuoteJsonFromFolder_(p.estimate_folder_url);
      return { ok: true, prospect: p };
    }
  }
  throw new Error('Prospect not found');
}

function trashFolderFromUrl_(url) {
  if (!url) return false;
  try {
    var folder = folderFromUrl_(url);
    if (!folder) return false;
    folder.setTrashed(true);
    return true;
  } catch (e) {
    return false;
  }
}

function handleDeleteQuote(data) {
  var id = clean_(data.prospectId);
  if (!id) throw new Error('Missing prospectId');
  var sheet = sheet_();
  var rows = sheet.getDataRange().getValues();
  var found = findRowById_(rows, id);
  if (found < 0) throw new Error('Prospect not found');
  var row = rows[found - 1];
  var trashedEstimate = trashFolderFromUrl_(row[17]);
  var trashedPhotos = trashFolderFromUrl_(row[14]);
  sheet.deleteRow(found);
  return {
    ok: true,
    prospectId: id,
    trashedEstimateFolder: trashedEstimate,
    trashedPhotoFolder: trashedPhotos
  };
}

function folderFromUrl_(url) {
  if (!url) return null;
  try {
    var idMatch = String(url).match(/[-\w]{25,}/);
    if (!idMatch) return null;
    return DriveApp.getFolderById(idMatch[0]);
  } catch (e) {
    return null;
  }
}

function trashNamedFiles_(folder, name) {
  var files = folder.getFilesByName(name);
  while (files.hasNext()) {
    try { files.next().setTrashed(true); } catch (e) {}
  }
}

function replaceNamedFile_(folder, name, blob) {
  trashNamedFiles_(folder, name);
  folder.createFile(blob);
}

function docIdFromUrl_(url) {
  if (!url) return '';
  var m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function insertLogo_(body) {
  try {
    var blob = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
    var img = body.appendImage(blob);
    img.setWidth(110);
    img.setHeight(110);
    body.appendParagraph('');
  } catch (e) {}
}

function fillEstimateDocBody_(doc, data, snap, stamp) {
  var first = clean_(data.first_name);
  var last = clean_(data.last_name);
  var body = doc.getBody();
  body.clear();
  insertLogo_(body);
  body.appendParagraph('+P Holiday Lighting').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Christmas Light Installation Estimate').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph(stamp || '');
  body.appendParagraph('');
  body.appendParagraph('Prepared for').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendParagraph([first, last].filter(String).join(' '));
  if (clean_(data.phone)) body.appendParagraph(clean_(data.phone));
  if (clean_(data.email)) body.appendParagraph(clean_(data.email));
  var addr = [clean_(data.street), [clean_(data.city), clean_(data.state) || 'TX'].filter(String).join(', '), clean_(data.zip)].filter(String).join(' ');
  if (addr) body.appendParagraph(addr);
  if (clean_(data.subdivision)) body.appendParagraph('Subdivision: ' + clean_(data.subdivision));
  body.appendParagraph('');

  var copy = (snap && snap.copyText) ? String(snap.copyText) : '';
  if (copy) {
    body.appendParagraph('Estimate details').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    var lines = copy.split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      body.appendParagraph(lines[i]);
    }
  } else {
    body.appendParagraph('First hang total: ' + (data.first_hang_total || ''));
    body.appendParagraph('Suggested rehang total: ' + (data.rehang_total || ''));
  }
  if (clean_(data.notes)) {
    body.appendParagraph('');
    body.appendParagraph('Notes').setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendParagraph(clean_(data.notes));
  }
  body.appendParagraph('');
  body.appendParagraph('Text or call: (214) 995-3002');
  body.appendParagraph('Email (secondary): pluspservices@gmail.com');
  doc.saveAndClose();
}

function writeEstimateDoc_(folder, data, snap, stamp, existingDocUrl) {
  var first = clean_(data.first_name);
  var last = clean_(data.last_name);
  var title = 'Estimate — ' + last + ', ' + first;
  try {
    var doc = null;
    var existingId = docIdFromUrl_(existingDocUrl);
    if (existingId) {
      try { doc = DocumentApp.openById(existingId); } catch (e) { doc = null; }
    }
    if (!doc) {
      var it = folder.getFilesByType(MimeType.GOOGLE_DOCS);
      if (it.hasNext()) {
        try { doc = DocumentApp.openById(it.next().getId()); } catch (e) { doc = null; }
      }
    }
    if (!doc) {
      doc = DocumentApp.create(title);
      var file = DriveApp.getFileById(doc.getId());
      folder.addFile(file);
      try { DriveApp.getRootFolder().removeFile(file); } catch (e) {}
    } else {
      try { doc.setName(title); } catch (e) {}
    }
    fillEstimateDocBody_(doc, data, snap, stamp);
    return doc.getUrl();
  } catch (err) {
    return writeEstimateTextFallback_(folder, data, snap, stamp, title);
  }
}

function writeEstimateTextFallback_(folder, data, snap, stamp, title) {
  var lines = [];
  lines.push('+P Holiday Lighting');
  lines.push('Christmas Light Installation Estimate');
  lines.push(stamp || '');
  lines.push('');
  lines.push('Prepared for');
  lines.push([clean_(data.first_name), clean_(data.last_name)].filter(String).join(' '));
  if (clean_(data.phone)) lines.push(clean_(data.phone));
  if (clean_(data.email)) lines.push(clean_(data.email));
  var addr = [clean_(data.street), [clean_(data.city), clean_(data.state) || 'TX'].filter(String).join(', '), clean_(data.zip)].filter(String).join(' ');
  if (addr) lines.push(addr);
  if (clean_(data.subdivision)) lines.push('Subdivision: ' + clean_(data.subdivision));
  lines.push('');
  var copy = (snap && snap.copyText) ? String(snap.copyText) : '';
  if (copy) {
    lines.push('Estimate details');
    lines.push(copy);
  } else {
    lines.push('First hang total: ' + (data.first_hang_total || ''));
    lines.push('Suggested rehang total: ' + (data.rehang_total || ''));
  }
  if (clean_(data.notes)) {
    lines.push('');
    lines.push('Notes');
    lines.push(clean_(data.notes));
  }
  lines.push('');
  lines.push('Text or call: (214) 995-3002');
  lines.push('Email (secondary): pluspservices@gmail.com');
  var name = 'Estimate.txt';
  replaceNamedFile_(folder, name, Utilities.newBlob(lines.join('\n'), 'text/plain', name));
  var files = folder.getFilesByName(name);
  if (files.hasNext()) return files.next().getUrl();
  return folder.getUrl();
}

/** Run once from the editor (Run ▶) to grant Google Docs permission, then Redeploy. */
function authorizeDocsPermission() {
  var doc = DocumentApp.create('+P Docs permission check');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
}

function clean_(v) { return String(v == null ? '' : v).trim(); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// The automated tests read these helpers. Apps Script has no module object, so this does nothing after paste.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizePhoneDigits_: normalizePhoneDigits_,
    phoneWithDots_: phoneWithDots_,
    splitStreetAddress_: splitStreetAddress_,
    splitStreet_: splitStreet_,
    isTestLead_: isTestLead_,
    planCustomerLead_: planCustomerLead_,
    planCustomerQuote_: planCustomerQuote_,
    planPipelineLead_: planPipelineLead_,
    planClientListLead_: planClientListLead_,
    buildLeadResponse_: buildLeadResponse_,
    readSheetGrid_: readSheetGrid_,
    setPlannedCells_: setPlannedCells_,
    writePipelinePlan_: writePipelinePlan_,
    writeClientListPlan_: writeClientListPlan_,
    trackerWritesEnabled_: trackerWritesEnabled_,
    CUSTOMERS_SHEET_ID: CUSTOMERS_SHEET_ID,
    PROSPECTS_SHEET_ID: PROSPECTS_SHEET_ID,
    ALSO_WRITE_CLIENT_TRACKER: ALSO_WRITE_CLIENT_TRACKER
  };
}
