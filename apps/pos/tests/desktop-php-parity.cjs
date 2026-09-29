// Run with ELECTRON_RUN_AS_NODE=1 <project Electron binary> tests/desktop-php-parity.cjs.
// Real SQLite repositories, mocked HTTP only. Never connects to a server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
function load(file) {
  const filename = path.join(root, file);
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' });
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(result.outputFiles[0].text, filename); return mod.exports;
}
const { PosDatabase, createRepos } = load('electron/main/db/index.ts');
const { savePosSale } = load('electron/main/db/save-pos-sale.ts');
const { QueueReader } = load('electron/main/sync/command-queue-reader.ts');
const { SyncHttpClient } = load('electron/main/sync/client-http.ts');
const { registerAllDbIpc } = load('electron/main/ipc-db-bridge.ts');
const auth = { mode: 'ONLINE', employeeId: 'employee_test', branchId: 'branch_test', restaurantId: 'restaurant_test', deviceId: 'device_test', accessToken: 'synthetic-test-only' };
const db = new PosDatabase(':memory:'); db.migrate(); const repos = createRepos(db); repos.meta.setLastAuth(auth);
function sale(id) {
  return { order: { id, restaurant_id: auth.restaurantId, branch_id: auth.branchId, employee_id: auth.employeeId,
    order_type: 'TAKEAWAY', order_number: id, source: 'POS', status: 'COMPLETED', payment_status: 'PAID',
    subtotal_cents: 400000, discount_cents: 0, tax_cents: 0, total_cents: 400000, tip_cents: 0, idempotency_key: id },
    payment: { id: `payment_${id}`, order_id: id, branch_id: auth.branchId, restaurant_id: auth.restaurantId, employee_id: auth.employeeId,
      method: 'CARD', amount_cents: 400000, status: 'PAID', idempotency_key: `payment_${id}` },
    items: [{ id: `item_${id}`, menu_item_id: 'menu_test', name_snapshot: 'Test food', price_snapshot_cents: 400000,
      quantity: 1, subtotal_cents: 400000, total_cents: 400000, tax_cents: 0, discount_cents: 0 }] };
}
const scalar = sql => db.get(sql).n;
async function main() {
  const originalPush = repos.syncQueue.push.bind(repos.syncQueue); let pushes = 0;
  repos.syncQueue.push = row => { if (++pushes === 3) throw new Error('simulated disk failure'); return originalPush(row); };
  assert.throws(() => savePosSale(repos, sale('rollback_test')), /disk failure/);
  for (const table of ['orders', 'payments', 'order_items', 'sync_queue']) assert.equal(scalar(`SELECT count(*) n FROM ${table}`), 0, `${table} must roll back`);
  repos.syncQueue.push = originalPush;
  const wrongScope = sale('wrong_scope'); wrongScope.order.branch_id = 'other_branch';
  assert.throws(() => savePosSale(repos, wrongScope), /current employee/);
  const modified = sale('modifier_test'); modified.items[0].modifierOptions = [{ priceDeltaCents: 50000 }];
  assert.throws(() => savePosSale(repos, modified), /without modifiers/);
  savePosSale(repos, sale('checkout_test')); savePosSale(repos, sale('checkout_test'));
  assert.equal(scalar('SELECT count(*) n FROM orders'), 1); assert.equal(scalar('SELECT count(*) n FROM payments'), 1);
  assert.equal(scalar('SELECT count(*) n FROM sync_queue'), 4);
  const changed = sale('checkout_test'); changed.order.total_cents = changed.order.subtotal_cents = changed.payment.amount_cents = 450000;
  assert.throws(() => savePosSale(repos, changed), /differs/);
  const rows = db.all('SELECT * FROM sync_queue ORDER BY id');
  const order = JSON.parse(rows[0].payload), payment = JSON.parse(rows[1].payload);
  assert.deepEqual(order.items, [{menuItemId: 'menu_test', quantity: 1}]);
  assert.equal(order.source, 'POS'); assert.equal(order.type, 'TAKEAWAY'); assert.equal(order.totalCents, 400000); assert.equal(order.expectedTotalCents, 400000);
  for (const field of ['status', 'paymentStatus', 'taxIds']) assert.equal(field in order, false);
  for (const field of ['status', 'verificationSource', 'providerResponse']) assert.equal(field in payment, false);
  assert.equal(payment.amountCents, 400000); assert.equal(payment.method, 'CARD');

  let currentAuth = {...auth}; let state = 'NONE'; let lost = false; const calls = [], applied = new Map();
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({url, body, headers: init.headers});
    assert.ok(!String(url).includes('/public/')); assert.ok(!('X-Idempotency-Key' in init.headers));
    if (String(url).includes('/shifts/')) return new Response(JSON.stringify({ data: { shift: { _id: 'server_shift_test' } } }), {status: 200});
    assert.equal(body.deviceId, auth.deviceId); assert.equal(body.restaurantId, auth.restaurantId); assert.equal(body.branchId, auth.branchId);
    const results = body.commands.map(c => {
      const prior = applied.get(c.idempotencyKey);
      if (prior) { assert.deepEqual(c, prior.command); return prior.result; }
      if (c.entityType === 'ORDER' && c.operation === 'CREATE') { assert.equal(state, 'NONE'); state = 'PENDING_UNPAID'; }
      else if (c.entityType === 'PAYMENT') { assert.equal(state, 'PENDING_UNPAID'); state = 'PENDING_PAID'; }
      else if (c.payload.status === 'READY') { assert.equal(state, 'PENDING_PAID'); state = 'READY'; }
      else { assert.equal(state, 'READY'); state = 'COMPLETED'; }
      const result = {idempotencyKey:c.idempotencyKey, status:'SUCCESS', serverSnapshot:{totalCents:400000}};
      applied.set(c.idempotencyKey, {command:c, result}); return result;
    });
    if (!lost) { lost = true; throw new Error('lost response'); }
    return new Response(JSON.stringify({data:results}), {status:200});
  };
  const client = new SyncHttpClient('http://127.0.0.1:1/api/v1', () => currentAuth, true);
  const reader = new QueueReader(repos, db, client, auth.deviceId, () => currentAuth, undefined, undefined, true);
  currentAuth = {...auth, accessToken: undefined}; reader.start(); await reader.requestNow(); assert.equal(calls.length, 0);
  currentAuth = {...auth, branchId:'other_branch'}; await reader.requestNow(); assert.equal(calls.length, 0);
  currentAuth = {...auth};
  for (let i=0; i<9; i++) { db.run('UPDATE sync_queue SET next_attempt_at = 0'); await reader.requestNow(); }
  assert.equal(state,'COMPLETED'); assert.equal(applied.size,4); assert.equal(scalar("SELECT count(*) n FROM sync_queue WHERE status='DONE'"),4);
  assert.equal(repos.orders.getById('checkout_test').synced,1);
  reader.stop();

  const handlers = new Map(); registerAllDbIpc({handle:(key,fn)=>handlers.set(key,fn)}, repos);
  const call = (key, input) => handlers.get(key)({}, input);
  const shift = {id:'local_shift_test',device_id:auth.deviceId,branch_id:auth.branchId,restaurant_id:auth.restaurantId,employee_id:auth.employeeId,opening_cash_cents:50000,idempotency_key:'open_shift_key'};
  repos.syncQueue.push = () => { throw new Error('simulated shift outbox failure'); };
  assert.equal((await call('db:shifts:open',shift)).success,false);
  assert.equal(scalar('SELECT count(*) n FROM shifts'),0);
  repos.syncQueue.push = originalPush;
  const open = await call('db:shifts:open',shift); assert.equal(open.success,true,open.error);
  repos.syncQueue.push = () => { throw new Error('simulated shift outbox failure'); };
  assert.equal((await call('db:shifts:close',{id:shift.id,closing_cash_cents:55000})).success,false);
  assert.equal(db.get('SELECT status FROM shifts WHERE id = ?',shift.id).status,'OPEN');
  repos.syncQueue.push = originalPush;
  const close = await call('db:shifts:close',{id:shift.id,closing_cash_cents:55000}); assert.equal(close.success,true,close.error);
  reader.start(); await new Promise(resolve => setImmediate(resolve));
  for(let i=0;i<5;i++){db.run('UPDATE sync_queue SET next_attempt_at = 0');await reader.requestNow();} reader.stop();
  const shiftCalls = calls.filter(c=>c.url.includes('/shifts/'));
  assert.equal(shiftCalls.length,2); assert.equal(shiftCalls[0].body.openingCash,50000); assert.equal(shiftCalls[0].body.deviceId,auth.deviceId);
  assert.ok(shiftCalls[1].url.endsWith('/shifts/server_shift_test/close'));assert.equal(shiftCalls[1].body.closingCash,55000);
  assert.equal(shiftCalls[1].body.idempotencyKey, 'shift_update_local_shift_test_closed');
  assert.ok(!calls.some(c=>c.body.commands?.some(cmd=>cmd.entityType==='SHIFT')));
  const { TableSessionService } = load('electron/main/db/repositories/table-sessions.repository.ts');
  const tables = new TableSessionService({ getById: () => ({ current_order_id:'order', discount_cents:50000, paid_amount_cents:100000, tip_cents:0 }) }, {}, { listItems: () => [{subtotal_cents:400000}] });
  const totals = tables.recompute('table', [{rate:7.5}]);
  assert.deepEqual(totals, {subtotal_cents:400000,discount_cents:50000,tax_cents:0,tip_cents:0,total_cents:350000,paid_amount_cents:100000,balance_due_cents:250000});
  console.log('PASS: atomic SQLite rollback/replay, PHP payloads, scope isolation, offline retention, lost-response retry, ordered lifecycle, shift endpoints.');
}
main().then(()=>db.close()).catch(e=>{console.error(e);db.close();process.exitCode=1;});
