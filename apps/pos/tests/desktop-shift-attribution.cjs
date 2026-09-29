// Run with ELECTRON_RUN_AS_NODE=1 <project Electron binary> tests/desktop-shift-attribution.cjs.
// Real SQLite repositories, mocked HTTP only. Never connects to a server.
const assert = require('node:assert/strict');
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
async function main() {
  const handlers = new Map(); registerAllDbIpc({handle:(key,fn)=>handlers.set(key,fn)}, repos);
  const call = (key, input) => handlers.get(key)({}, input);
  const shift = {id:'local_A',device_id:auth.deviceId,branch_id:auth.branchId,restaurant_id:auth.restaurantId,employee_id:auth.employeeId,opening_cash_cents:50000,idempotency_key:'open_A'};
  assert.equal((await call('db:shifts:open',shift)).success,true);
  const input = sale('sale_A'); input.order.shift_id = input.payment.shift_id = shift.id;
  savePosSale(repos,input);
  const savedPayment = db.get("SELECT * FROM sync_queue WHERE entity_type='PAYMENT'");
  assert.equal(JSON.parse(savedPayment.payload).localShiftId,'local_A');
  assert.equal(repos.shifts.getById('local_A').serverShiftId,undefined);
  assert.equal((await call('db:shifts:close',{id:shift.id,closing_cash_cents:50000})).success,true);
  assert.equal((await call('db:shifts:open',{...shift,id:'local_B',idempotency_key:'open_B'})).success,true);
  savePosSale(repos,sale('unrelated'));
  let online=false, failOpen=true, losePayment=true;
  const opens=[], payments=[];
  const currentAuth=()=>({...auth,accessToken:online?auth.accessToken:undefined});
  global.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);
    if(String(url).endsWith('/shifts/open')) {
      opens.push(body);
      if(failOpen) return new Response(JSON.stringify({error:{message:'temporary'}}),{status:503});
      return new Response(JSON.stringify({data:{shift:{_id:body.idempotencyKey.includes('local_A')?'server_A':'server_B'}}}),{status:200});
    }
    if(String(url).includes('/shifts/')) return new Response(JSON.stringify({data:{shift:{_id:'server_A'}}}),{status:200});
    const results=body.commands.map(c=>{
      if(c.entityType==='PAYMENT') {
        payments.push(c);
        if(c.entityId===input.payment.id) {
          assert.equal(c.payload.shiftId,'server_A');
          assert.equal(c.payload.currency,'NGN');
          assert.equal('localShiftId' in c.payload,false);
        }
      }
      return {idempotencyKey:c.idempotencyKey,status:'SUCCESS',serverSnapshot:{id:c.entityId}};
    });
    if(body.commands.some(c=>c.entityId===input.payment.id)&&losePayment){losePayment=false;throw new Error('lost payment response');}
    return new Response(JSON.stringify({data:results}),{status:200});
  };
  const client=new SyncHttpClient('http://127.0.0.1:1/api/v1',currentAuth,true);
  let reader=new QueueReader(repos,db,client,auth.deviceId,currentAuth,undefined,undefined,true);
  const cycle=async(n)=>{for(let i=0;i<n;i++){db.run('UPDATE sync_queue SET next_attempt_at=0');await reader.requestNow();}};
  reader.start(); await reader.requestNow(); assert.equal(opens.length,0);
  online=true;await cycle(6);
  assert.ok(opens.length>1);assert.equal(payments.some(c=>c.entityId===input.payment.id),false);
  assert.ok(payments.some(c=>c.payload.orderId==='unrelated'),'unrelated sale proceeds');
  assert.notEqual(db.get('SELECT status FROM sync_queue WHERE op_id=?',savedPayment.op_id).status,'DONE');
  failOpen=false;await cycle(1);
  assert.equal(repos.shifts.getById('local_A').serverShiftId,'server_A');
  assert.equal(repos.shifts.getById('local_A').status,'CLOSED');
  // Recreate reader/repositories: identity is durable, not an in-memory mapping.
  reader.stop();reader=new QueueReader(createRepos(db),db,client,auth.deviceId,currentAuth,undefined,undefined,true);
  reader.start();await cycle(12);reader.stop();
  assert.equal(repos.shifts.getOpen(auth.deviceId).serverShiftId,'server_B');
  const attempts=payments.filter(c=>c.entityId===input.payment.id);
  assert.ok(attempts.length>=2);assert.deepEqual(attempts[0],attempts[1]);
  assert.ok(opens.filter(c=>c.idempotencyKey.includes('local_A')).every(c=>c.idempotencyKey===opens[0].idempotencyKey));
  assert.equal(db.get('SELECT status FROM sync_queue WHERE op_id=?',savedPayment.op_id).status,'DONE');
  assert.equal(JSON.parse(db.get('SELECT payload FROM sync_queue WHERE op_id=?',savedPayment.op_id).payload).localShiftId,'local_A');
  const legacy=sale('legacy');legacy.order.shift_id=legacy.payment.shift_id='local_A';savePosSale(repos,legacy);
  const legacyRow=db.get("SELECT * FROM sync_queue WHERE entity_id=? AND entity_type='PAYMENT'",legacy.payment.id);
  const legacyPayload=JSON.parse(legacyRow.payload);delete legacyPayload.localShiftId;
  db.run('UPDATE sync_queue SET payload=? WHERE op_id=?',JSON.stringify(legacyPayload),legacyRow.op_id);
  reader.start();await cycle(5);reader.stop();
  assert.equal(payments.some(c=>c.entityId===legacy.payment.id),false,'legacy shift-associated payment is held, never sent unassigned');
  console.log('PASS: offline original shift, durable server mapping, closed A/current B isolation, dependency failure/unrelated progress, stable OPEN/payment retries.');
}
main().then(()=>db.close()).catch(e=>{console.error(e);db.close();process.exitCode=1;});
