/**
 * +P Holiday Lighting — Prospects API
 * Deploy: Deploy → Manage deployments → Edit → New version → Deploy
 * Execute as: Me · Who has access: Anyone
 */
var PROSPECTS_SHEET_ID = '1lRYPaL2TR1YM1zj5A983FUMdOq74OKo_z3V4CTI84Tk';
var LEAD_PHOTOS_FOLDER_ID = '1c2sHhFctt5DU9ZSOOqfB5-plMKeoNyu6';
var QUOTES_FOLDER_ID = '1JPLVPb0qwDYKwaKPu86Hdo3jgQZhrj9x';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'lead';
    var out;
    if (action === 'lead') out = handleLead(data);
    else if (action === 'saveQuote') out = handleSaveQuote(data);
    else if (action === 'listQuotes') out = handleListQuotes();
    else if (action === 'getQuote') out = handleGetQuote(data);
    else throw new Error('Unknown action: ' + action);
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json_({ ok: true, service: '+P Prospects API', time: new Date().toISOString() });
}

function sheet_() {
  var ss = SpreadsheetApp.openById(PROSPECTS_SHEET_ID);
  return ss.getSheetByName('Pipeline') || ss.getSheets()[0];
}

function handleLead(data) {
  var first = clean_(data.first_name);
  var last = clean_(data.last_name);
  var street = clean_(data.street);
  var city = clean_(data.city);
  var state = clean_(data.state) || 'TX';
  var zip = clean_(data.zip);
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
  for (var i = 0; i < photos.length && i < 6; i++) {
    var p = photos[i];
    if (!p || !p.data) continue;
    var bytes = Utilities.base64Decode(String(p.data).replace(/^data:image\/[a-zA-Z+]+;base64,/, ''));
    var blob = Utilities.newBlob(bytes, p.mime || 'image/jpeg', p.name || ('photo-' + (i + 1) + '.jpg'));
    folder.createFile(blob);
    saved++;
  }

  var sheet = sheet_();
  sheet.appendRow([
    id, stamp, 'New lead', first, last, phone, email, street, subdivision, city, state, zip,
    notes, saved, folder.getUrl(), '', '', '', stamp, 'customer form'
  ]);

  return {
    ok: true,
    prospectId: id,
    photoCount: saved,
    folderUrl: folder.getUrl(),
    sheetUrl: 'https://docs.google.com/spreadsheets/d/' + PROSPECTS_SHEET_ID + '/edit'
  };
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

function normalizePhone_(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
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

  var folderName = 'Estimate ' + stamp + ' ' + last + ', ' + first + ' — ' + street;
  folderName = folderName.substring(0, 120);
  var parent = DriveApp.getFolderById(QUOTES_FOLDER_ID);
  var folder = parent.createFolder(folderName);

  var snap = data.quote_json || null;
  if (snap) {
    folder.createFile(Utilities.newBlob(JSON.stringify(snap, null, 2), 'application/json', 'quote.json'));
  }
  if (data.pdf_base64) {
    var pdfBytes = Utilities.base64Decode(String(data.pdf_base64).replace(/^data:application\/pdf;base64,/, ''));
    folder.createFile(Utilities.newBlob(pdfBytes, 'application/pdf', 'estimate.pdf'));
  }

  var status = clean_(data.status) || 'Estimate saved';
  var row = [
    id, stamp, status, first, last,
    phone, clean_(data.email), street, clean_(data.subdivision),
    clean_(data.city), clean_(data.state) || 'TX', clean_(data.zip), clean_(data.notes),
    '', '', data.first_hang_total || '', data.rehang_total || '', folder.getUrl(), stamp, 'estimate app'
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

  return { ok: true, prospectId: id, folderUrl: folder.getUrl() };
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
    source: r[19]
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
    var files = folder.getFilesByName('quote.json');
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

function clean_(v) { return String(v == null ? '' : v).trim(); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
