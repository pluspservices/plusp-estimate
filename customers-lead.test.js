const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'Code.gs' });
const api = sandbox.module.exports;

const API = 'https://script.google.com/macros/s/AKfycbzbvvFGqolPI0zKlmWQhngCW-oDjz7mSR6hZflztejyeS_NxzVteUOxJE3gH_MOJO3gcg/exec';
const CUSTOMER_HEADERS = [
  'First', 'Last', 'Status', 'Phone', 'Address', 'City / Area', 'Install date', 'My estimate',
  'Final price', 'Rehang price', 'Paid to date', 'Check', 'Pipeline status', 'Roofline',
  'Clip / glue codes', 'Extras', 'Notes', 'Email', 'ZIP', 'Lead date', 'Source', 'Photos folder',
  'Estimate doc', 'Lead ID'
];
const PIPELINE_HEADERS = [
  'ID', 'Date', 'Status', 'First', 'Last', 'Phone', 'Email', 'Street', 'Subdivision', 'City',
  'State', 'ZIP', 'Notes', 'Photos', 'Photos folder', 'First hang $', 'Rehang $', 'Estimate folder',
  'Updated', 'Source', 'Estimate doc'
];
const CLIENT_HEADERS = [
  'Disposition', 'First Name', 'Last Name', 'Phone Number', 'Address', 'Street', 'City',
  'Est. new (notes)', 'rehang (notes)', 'Roofline', 'Gluing', 'Other', 'Notes'
];

function blankRow() {
  return CUSTOMER_HEADERS.map(() => '');
}

function customerGrid(rows, formulasByRow) {
  const values = rows.map((row) => {
    const line = blankRow();
    Object.keys(row).forEach((key) => {
      const idx = CUSTOMER_HEADERS.indexOf(key);
      if (idx >= 0) line[idx] = row[key];
    });
    return line;
  });
  const formulas = values.map(() => CUSTOMER_HEADERS.map(() => ''));
  (formulasByRow || []).forEach((entry) => {
    const idx = CUSTOMER_HEADERS.indexOf(entry.header);
    formulas[entry.row][idx] = entry.formula;
  });
  const formulasRow2 = CUSTOMER_HEADERS.map((header, i) => {
    if (header === 'Paid to date' || header === 'Check') return '=ARRAYFORMULA(IF(E2:E="","",1))';
    return formulas[0] ? formulas[0][i] : '';
  });
  return {
    headers: CUSTOMER_HEADERS.slice(),
    headerFormulas: CUSTOMER_HEADERS.map(() => ''),
    formulasRow2: formulasRow2,
    values: values,
    formulas: formulas
  };
}

function lead(extra) {
  return Object.assign({
    id: 'abc12345',
    stamp: '2026-11-22 09:00',
    first: 'Sam',
    last: 'Sample',
    phone: '(555) 010-0199',
    rawStreet: '100 Example Lane',
    street: '100 Example Lane',
    city: 'Prosper',
    state: 'TX',
    zip: '75078',
    email: 'sam.sample@example.com',
    subdivision: '',
    notes: 'Gate code 1234',
    source: 'customer form',
    folderUrl: 'https://drive.google.com/drive/folders/new-folder',
    photoCount: 2,
    estimateLow: ''
  }, extra || {});
}

function same(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
}

function writes(plan) {
  const out = {};
  (plan.writes || []).forEach((w) => { out[w.col] = w.value; });
  return out;
}

function col(name) {
  return CUSTOMER_HEADERS.indexOf(name) + 1;
}

test('config block keeps both sheet ids and the Client Tracker switch', () => {
  assert.equal(api.CUSTOMERS_SHEET_ID, '1o8i8rO1x763kClQg4YKp01OgPaGWcSW0pphOUu1Evd8');
  assert.equal(api.PROSPECTS_SHEET_ID, '1c4i2baYHHj2Ck8pGkq1ddoTiAC89FF4Jt2AfxbKjIKk');
  assert.equal(api.ALSO_WRITE_CLIENT_TRACKER, true);
  assert.equal(api.trackerWritesEnabled_(), true);
  const top = src.slice(0, src.indexOf('function doPost'));
  assert.match(top, /CUSTOMERS_SHEET_ID = '1o8i8rO1x763kClQg4YKp01OgPaGWcSW0pphOUu1Evd8'/);
  assert.match(top, /PROSPECTS_SHEET_ID = '1c4i2baYHHj2Ck8pGkq1ddoTiAC89FF4Jt2AfxbKjIKk'/);
  assert.match(top, /ALSO_WRITE_CLIENT_TRACKER = true/);
});

test('phones normalize to the same 10 digits and dotted display', () => {
  ['(214) 555-0199', '214-555-0199', '214.555.0199', '2145550199', '1-214-555-0199', '+1 214 555 0199'].forEach((value) => {
    assert.equal(api.normalizePhoneDigits_(value), '2145550199');
    assert.equal(api.phoneWithDots_(value), '214.555.0199');
  });
  assert.equal(api.normalizePhoneDigits_('214.995.3002'), '2149953002');
  assert.equal(api.phoneWithDots_('call me'), 'call me');
});

test('a full address typed into the street field is split', () => {
  same(api.splitStreetAddress_('123 Main St, Plano, TX 75024', '', 'TX', ''), {
    street: '123 Main St', city: 'Plano', state: 'TX', zip: '75024'
  });
  same(api.splitStreetAddress_('123 Main St, Plano, Texas 75024', '', '', ''), {
    street: '123 Main St', city: 'Plano', state: 'TX', zip: '75024'
  });
  same(api.splitStreetAddress_('123 Main Street Plano TX 75024', '', 'TX', ''), {
    street: '123 Main Street', city: 'Plano', state: 'TX', zip: '75024'
  });
  same(api.splitStreetAddress_('123 Main St, Tulsa, OK 74103', '', 'TX', ''), {
    street: '123 Main St', city: 'Tulsa', state: 'OK', zip: '74103'
  });
  same(api.splitStreetAddress_('10 Oak Street', 'Prosper', 'TX', '75078'), {
    street: '10 Oak Street', city: 'Prosper', state: 'TX', zip: '75078'
  });
  same(api.splitStreetAddress_('123 Main St, Plano, TX 75024', 'Plano', 'TX', '75024'), {
    street: '123 Main St', city: 'Plano', state: 'TX', zip: '75024'
  });
  same(api.splitStreet_('6332 Winsor'), { number: '6332', name: 'Winsor' });
});

test('obvious test submissions are recognized and not written to Customers', () => {
  assert.equal(api.isTestLead_(lead({ last: 'Tester' })), true);
  assert.equal(api.isTestLead_(lead({ first: 'Test', last: 'Sample' })), true);
  assert.equal(api.isTestLead_(lead({ first: 'LightingBot', last: 'Sample' })), true);
  assert.equal(api.isTestLead_(lead({ last: 'lightingbot' })), true);
  assert.equal(api.isTestLead_(lead({ street: '6040 Oakmere Rd', rawStreet: '6040 Oakmere Rd' })), true);
  assert.equal(api.isTestLead_(lead({ rawStreet: '6040 Oakmere, Rowlett, TX 75089', street: '6040 Oakmere' })), true);
  ['2149953002', '214.995.3002', '(214) 995-3002', '1-214-995-3002'].forEach((phone) => {
    assert.equal(api.isTestLead_(lead({ phone: phone })), true);
  });
  assert.equal(api.isTestLead_(lead()), false);
  const grid = customerGrid([{ First: 'Amber', Last: 'Verrett', Status: 'Installed', Phone: '504.931.8165', Address: '6332 Winsor' }]);
  const skipped = api.planCustomerLead_(grid, lead({ last: 'Tester' }));
  assert.equal(skipped.action, 'skip');
  same(skipped.writes, []);
});

test('a new lead is appended after the last name or address, not after formula rows', () => {
  const rows = [
    { First: 'Amber', Last: 'Verrett', Status: 'Installed', Phone: '504.931.8165', Address: '6332 Winsor', 'City / Area': 'Sutton Fields' },
    { First: 'Heather', Last: 'Reed', Status: 'Installed', Phone: '918.914.3729', Address: '760 Hunters Pl', 'City / Area': 'Prosper' },
    { First: 'Kapil', Last: 'Changrani', Status: 'Installed', Phone: '469.803.2999', Address: '5329 Austen Ave' }
  ];
  const grid = customerGrid(rows);
  for (let i = 0; i < 12; i++) {
    const spill = blankRow();
    spill[10] = '0';
    spill[11] = 'spill';
    grid.values.push(spill);
    grid.formulas.push(CUSTOMER_HEADERS.map(() => ''));
  }
  const plan = api.planCustomerLead_(grid, lead({ subdivision: 'Example Hills' }));
  assert.equal(plan.action, 'append');
  assert.equal(plan.row, 5);
  const w = writes(plan);
  assert.equal(w[col('First')], 'Sam');
  assert.equal(w[col('Last')], 'Sample');
  assert.equal(w[col('Status')], 'Awaiting Quote');
  assert.equal(w[col('Phone')], '555.010.0199');
  assert.equal(w[col('Address')], '100 Example Lane');
  assert.equal(w[col('City / Area')], 'Prosper / Example Hills');
  assert.equal(w[col('Email')], 'sam.sample@example.com');
  assert.equal(w[col('ZIP')], '75078');
  assert.equal(w[col('Lead date')], '2026-11-22 09:00');
  assert.equal(w[col('Source')], 'customer form');
  assert.equal(w[col('Photos folder')], 'https://drive.google.com/drive/folders/new-folder');
  assert.equal(w[col('Lead ID')], 'abc12345');
  assert.equal(w[col('Notes')], 'Gate code 1234');
  assert.equal(w[col('Paid to date')], undefined);
  assert.equal(w[col('Check')], undefined);
  assert.equal(w[col('My estimate')], undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(w, col('Paid to date')), false);
  assert.equal(Object.prototype.hasOwnProperty.call(w, col('Check')), false);
});

test('a matching phone updates blanks and appends notes instead of adding a row', () => {
  const grid = customerGrid([
    {
      First: 'Amber', Last: 'Verrett', Status: 'Installed', Phone: '214.555.0199',
      Address: '6332 Winsor', 'City / Area': 'Sutton Fields', Notes: 'Existing note',
      'Photos folder': 'https://drive.google.com/drive/folders/old', 'Lead ID': 'keep-me'
    }
  ], [{ row: 0, header: 'Notes', formula: '=A2' }]);
  const blockedNotes = api.planCustomerLead_(grid, lead({
    first: 'Different',
    phone: '1 (214) 555-0199',
    notes: 'Added detail',
    folderUrl: 'https://drive.google.com/drive/folders/new-folder'
  }));
  assert.equal(blockedNotes.action, 'update');
  assert.equal(blockedNotes.row, 2);
  assert.equal(blockedNotes.deduped, true);
  assert.equal(blockedNotes.leadId, 'keep-me');
  const blocked = writes(blockedNotes);
  assert.equal(blocked[col('First')], undefined);
  assert.equal(blocked[col('Status')], undefined);
  assert.equal(blocked[col('Photos folder')], undefined);
  assert.equal(blocked[col('Notes')], undefined);

  const open = customerGrid([
    {
      First: 'Amber', Last: 'Verrett', Status: 'Installed', Phone: '214.555.0199',
      Address: '6332 Winsor', 'City / Area': 'Sutton Fields', Notes: 'Existing note',
      'Photos folder': 'https://drive.google.com/drive/folders/old', 'Lead ID': 'keep-me'
    }
  ]);
  const plan = api.planCustomerLead_(open, lead({
    first: 'Different',
    phone: '(214) 555-0199',
    email: 'new@example.com',
    notes: 'Added detail',
    folderUrl: 'https://drive.google.com/drive/folders/new-folder'
  }));
  const w = writes(plan);
  assert.equal(w[col('First')], undefined);
  assert.equal(w[col('Status')], undefined);
  assert.equal(w[col('Address')], undefined);
  assert.equal(w[col('Photos folder')], undefined);
  assert.equal(w[col('Email')], 'new@example.com');
  assert.match(w[col('Notes')], /Existing note/);
  assert.match(w[col('Notes')], /Added detail/);
  assert.match(w[col('Notes')], /Photos folder: https:\/\/drive\.google\.com\/drive\/folders\/new-folder/);
});

test('save quote updates Customers by phone, then address, and does not downgrade status', () => {
  const grid = customerGrid([
    { First: 'Amber', Last: 'Verrett', Status: 'Installed', Phone: '214.555.0199', Address: '6332 Winsor', 'My estimate': 250 },
    { First: 'Ada', Last: 'Sample', Status: 'Awaiting Quote', Phone: '469.111.2222', Address: '10 Oak Street' },
    { First: 'Bo', Last: 'Blank', Status: '', Phone: '469.111.3333', Address: '11 Oak Street', 'Estimate doc': 'https://docs.google.com/document/d/old' },
    { First: 'Cy', Last: 'Quoted', Status: 'Quoted', Phone: '469.111.4444', Address: '12 Oak Street' },
    { First: 'Dee', Last: 'Later', Status: 'Next year', Phone: '469.111.5555', Address: '13 Oak Street' },
    { First: 'Ev', Last: 'No', Status: 'Declined', Phone: '469.111.6666', Address: '14 Oak Street' },
    { First: 'Fay', Last: 'Soon', Status: 'Scheduled', Phone: '469.111.7777', Address: '15 Oak Street' }
  ]);
  const installed = api.planCustomerQuote_(grid, {
    phone: '(214) 555-0199', street: '999 Other St', estimate: 480, docUrl: 'https://docs.google.com/document/d/new'
  });
  assert.equal(installed.row, 2);
  const installedWrites = writes(installed);
  assert.equal(installedWrites[col('Status')], undefined);
  assert.equal(installedWrites[col('My estimate')], undefined);
  assert.equal(installedWrites[col('Estimate doc')], 'https://docs.google.com/document/d/new');

  const byAddress = api.planCustomerQuote_(grid, {
    phone: '000.000.0000', street: '10 Oak Street, Prosper, TX 75078', estimate: 300, docUrl: 'https://docs.google.com/document/d/ada'
  });
  assert.equal(byAddress.action, 'none');
  const parsed = api.splitStreetAddress_('10 Oak Street, Prosper, TX 75078', 'Prosper', 'TX', '75078');
  const byAddressParsed = api.planCustomerQuote_(grid, {
    phone: '000.000.0000', street: parsed.street, estimate: 300, docUrl: 'https://docs.google.com/document/d/ada'
  });
  assert.equal(byAddressParsed.row, 3);
  assert.equal(writes(byAddressParsed)[col('Status')], 'Quoted');
  assert.equal(writes(byAddressParsed)[col('My estimate')], 300);

  assert.equal(writes(api.planCustomerQuote_(grid, { phone: '469.111.3333', street: '11 Oak Street', estimate: 0, docUrl: 'https://docs.google.com/document/d/bo' }))[col('Status')], 'Quoted');
  assert.equal(writes(api.planCustomerQuote_(grid, { phone: '469.111.4444', street: '12 Oak Street', estimate: 10, docUrl: '' }))[col('Status')], 'Quoted');
  ['469.111.5555', '469.111.6666', '469.111.7777'].forEach((phone) => {
    assert.equal(writes(api.planCustomerQuote_(grid, { phone: phone, street: 'x', estimate: 10, docUrl: 'https://docs.google.com/document/d/x' }))[col('Status')], undefined);
  });
  assert.equal(api.planCustomerQuote_(grid, { phone: '111.222.3333', street: '999 Nowhere', estimate: 10, docUrl: 'https://docs.google.com/document/d/x' }).action, 'none');
});

test('pipeline and client list update the phone match and append a new row in the old shape', () => {
  const pipeline = [PIPELINE_HEADERS, [
    'id-old', '2026-10-01 19:23', 'Booked', 'Amber', 'Verrett', '2145550199', '',
    '6332 Winsor', '', 'Celina', 'TX', '75009', 'Old note', 4,
    'https://drive.google.com/drive/folders/old', 325, '', '', '2026-10-01 19:23', 'customer form', ''
  ]];
  const update = api.planPipelineLead_(pipeline, lead({ phone: '(214) 555-0199', estimateLow: 100, notes: 'New note' }));
  assert.equal(update.action, 'update');
  assert.equal(update.row, 2);
  assert.equal(update.values[2], 'Booked');
  assert.equal(update.values[3], 'Amber');
  assert.equal(update.values[6], 'sam.sample@example.com');
  assert.match(update.values[12], /Old note/);
  assert.match(update.values[12], /New note/);
  assert.match(update.values[12], /Photos folder: https:\/\/drive\.google\.com\/drive\/folders\/new-folder/);
  assert.equal(update.values[13], 4);
  assert.equal(update.values[14], 'https://drive.google.com/drive/folders/old');
  assert.equal(update.values[15], 325);

  const fresh = api.planPipelineLead_([PIPELINE_HEADERS], lead({ estimateLow: 640 }));
  assert.equal(fresh.action, 'append');
  assert.equal(fresh.values[2], 'New lead');
  assert.equal(fresh.values[5], '555.010.0199');
  assert.equal(fresh.values[7], '100 Example Lane');
  assert.equal(fresh.values[12], 'Gate code 1234');
  assert.equal(fresh.values[13], 2);
  assert.equal(fresh.values[14], 'https://drive.google.com/drive/folders/new-folder');
  assert.equal(fresh.values[15], 640);
  assert.equal(fresh.values[19], 'customer form');
  assert.equal(fresh.values.length, 20);

  const client = [CLIENT_HEADERS, [
    'Installed', 'Amber', 'Verrett', '214.555.0199', '6332', 'Winsor', 'Celina', '', '', '', '', '', 'Old list note'
  ]];
  const listUpdate = api.planClientListLead_(client, lead({ phone: '214.555.0199', city: '', notes: 'List addition' }));
  assert.equal(listUpdate.action, 'update');
  assert.equal(listUpdate.values[0], 'Installed');
  assert.equal(listUpdate.values[1], 'Amber');
  assert.match(listUpdate.values[12], /Old list note/);
  assert.match(listUpdate.values[12], /List addition/);

  const listNew = api.planClientListLead_([CLIENT_HEADERS], lead());
  same(listNew.values, ['Awaiting Quote', 'Sam', 'Sample', '555.010.0199', '100', 'Example Lane', 'Prosper']);
});

test('photo failure is not a plain success, and a missed sheet write is an error', () => {
  const photos = api.buildLeadResponse_({ saved: 0, attached: 2, customersWrote: true, trackerWrote: true });
  assert.equal(photos.ok, true);
  assert.equal(photos.status, 'partial');
  assert.equal(photos.photosFailed, true);
  assert.equal(photos.photoCount, 0);
  assert.match(photos.error, /none saved/i);

  const saved = api.buildLeadResponse_({ saved: 2, attached: 2, customersWrote: true, trackerWrote: true });
  assert.equal(saved.ok, true);
  assert.equal(saved.status, 'ok');
  assert.equal(saved.photosFailed, false);
  assert.equal(saved.photoCount, 2);

  const none = api.buildLeadResponse_({ saved: 0, attached: 0, customersWrote: false, trackerWrote: false, customersError: 'no access' });
  assert.equal(none.ok, false);
  assert.equal(none.status, 'error');
  assert.match(none.error, /no access/);

  const backup = api.buildLeadResponse_({ saved: 1, attached: 1, customersWrote: false, trackerWrote: true, customersError: 'Customers tab missing' });
  assert.equal(backup.ok, true);
  assert.equal(backup.status, 'partial');
  assert.equal(backup.customersError, 'Customers tab missing');
  assert.equal(backup.photoCount, 1);
});

test('formula columns are not written when the plan is applied', () => {
  const headers = CUSTOMER_HEADERS.slice();
  const matrix = [headers, blankRow(), blankRow(), blankRow()];
  matrix[1][0] = 'Amber';
  matrix[1][1] = 'Verrett';
  matrix[1][2] = 'Installed';
  matrix[1][3] = '504.931.8165';
  matrix[1][4] = '6332 Winsor';
  const formulas = matrix.map((row) => row.map(() => ''));
  formulas[1][10] = '=ARRAYFORMULA(IF(E2:E="","",SUMIF(Payments!C:C,E2:E,Payments!D:D)))';
  formulas[1][11] = '=ARRAYFORMULA(IF(C2:C="","",""))';
  formulas[1][16] = '=A2';
  const sheet = fakeSheet(matrix, formulas);
  const grid = api.readSheetGrid_(sheet);
  const plan = api.planCustomerLead_(grid, lead());
  assert.equal(plan.row, 3);
  api.setPlannedCells_(sheet, plan.row, plan.writes.concat([{ col: 11, value: 'SHOULD NOT STICK' }]));
  assert.equal(matrix[2][0], 'Sam');
  assert.equal(matrix[2][2], 'Awaiting Quote');
  assert.equal(matrix[2][10], '');
  assert.equal(formulas[1][10].indexOf('=ARRAYFORMULA'), 0);
  assert.notEqual(matrix[1][10], 'SHOULD NOT STICK');
  assert.equal(matrix[0][10], 'Paid to date');
});

test('the site keeps the same Apps Script URL and still emails when a save fails', () => {
  const customer = fs.readFileSync(path.join(ROOT, 'customer.html'), 'utf8');
  const design = fs.readFileSync(path.join(ROOT, 'design.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  [customer, design, index].forEach((file) => assert.match(file, /AKfycbzbvvFGqolPI0zKlmWQhngCW-oDjz7mSR6hZflztejyeS_NxzVteUOxJE3gH_MOJO3gcg/));
  assert.match(customer, /SAVE FAILED — /);
  assert.match(customer, /Photos saved:/);
  assert.match(customer, /photosDidNotSave/);
  assert.match(customer, /we got your request/i);
  assert.match(design, /SAVE FAILED — \+P light design/);
  assert.match(design, /Photos saved to Drive:/);
  assert.match(design, /photos did not save/i);
  assert.match(design, /emailSent !== true/);
  assert.equal(index.includes('SAVE FAILED'), false);
});

function fakeSheet(matrix, formulas) {
  function ensure(r, c) {
    while (matrix.length <= r) matrix.push([]);
    while ((matrix[r] || []).length <= c) matrix[r].push('');
    while (formulas.length <= r) formulas.push([]);
    while ((formulas[r] || []).length <= c) formulas[r].push('');
  }
  return {
    getLastRow: function () { return matrix.length; },
    getLastColumn: function () { return matrix[0].length; },
    getRange: function (row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      return {
        getValues: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) {
              ensure(row - 1 + r, col - 1 + c);
              line.push(matrix[row - 1 + r][col - 1 + c]);
            }
            out.push(line);
          }
          return out;
        },
        getFormulas: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numCols; c++) {
              ensure(row - 1 + r, col - 1 + c);
              line.push(formulas[row - 1 + r][col - 1 + c] || '');
            }
            out.push(line);
          }
          return out;
        },
        getValue: function () {
          ensure(row - 1, col - 1);
          return matrix[row - 1][col - 1];
        },
        getFormula: function () {
          ensure(row - 1, col - 1);
          return formulas[row - 1][col - 1] || '';
        },
        setValue: function (v) {
          ensure(row - 1, col - 1);
          matrix[row - 1][col - 1] = v;
        }
      };
    }
  };
}
