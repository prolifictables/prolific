import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PosDatabase, createRepos } from '../electron/main/db';
import { savePosSale } from '../electron/main/db/save-pos-sale';
import { registerAllDbIpc } from '../electron/main/ipc-db-bridge';
import { QueueReader } from '../electron/main/sync/command-queue-reader';
import { SyncHttpClient, ApiError } from '../electron/main/sync/client-http';

// Run through run-staging-outbox.py: never point this at an existing operator DB.
if (process.env.PROLIFIC_OUTBOX_STAGING_TEST !== '1') throw new Error('Explicit staging opt-in required');
const base = process.env.PROLIFIC_OUTBOX_STAGING_URL || '';
assert.equal(base, 'http://127.0.0.1:18787/api/v1');
const fixtureScript = process.env.PROLIFIC_OUTBOX_FIXTURES || '';
assert.match(fixtureScript, /\/prolific-outbox-e2e-[^/]+\/api\/bin\/staging\/outbox-e2e-fixtures.php$/);
function inspect(action = 'inspect'): any {
  return JSON.parse(execFileSync('php', [fixtureScript, action], { encoding: 'utf8' }));
}
const fixture = inspect();
assert.equal(fixture.database, 'prolific_staging');
assert.equal(fixture.fixtureScope, 'PHP_STAGING_V1');
assert.equal(fixture.storedPrice, fixture.priceCents);
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(deviceId = fixture.deviceId) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ employeeId: fixture.employeeId, branchId: fixture.branchId, restaurantId: fixture.restaurantId,
    deviceId, role: 'CASHIER', permissions: ['ORDER_CREATE', 'ORDER_EDIT', 'PAYMENT_ACCEPT', 'SHIFT_OPEN', 'SHIFT_CLOSE'],
    tokenType: 'access', iss: 'staging-test', aud: 'staging-test', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+1800 });
  return `${h}.${p}.${crypto.createHmac('sha256', 'S'.repeat(40)).update(`${h}.${p}`).digest('base64url')}`;
}
const auth = { mode: 'ONLINE' as const, accessToken: token(), deviceId: fixture.deviceId, employeeId: fixture.employeeId,
  branchId: fixture.branchId, restaurantId: fixture.restaurantId };
const db = new PosDatabase(':memory:'); db.migrate();
const repos = createRepos(db); repos.meta.setLastAuth(auth);
const handlers = new Map<string, Function>();
registerAllDbIpc({ handle: (key: string, fn: Function) => handlers.set(key, fn) } as any, repos);
async function ipc(key: string, input: any) {
  const result = await handlers.get(key)!({}, input);
  assert.equal(result.success, true, result.error); return result.data;
}
let online = false;
const getAuth = () => ({ ...auth, accessToken: online ? auth.accessToken : undefined });
const client = new SyncHttpClient(base, getAuth, true);
let reader = new QueueReader(repos, db, client, auth.deviceId, getAuth, undefined, undefined, true);
const row = (opId: string) => db.get<any>('SELECT * FROM sync_queue WHERE op_id=?', opId);
async function cycle() {
  // Accelerate only in-memory client retry deadlines; never mutate server records.
  db.run('UPDATE sync_queue SET next_attempt_at=0');
  await reader.requestNow();
  await new Promise(resolve => setTimeout(resolve, 20));
}
async function until(opId: string, expected = 'DONE') {
  for (let n=0; n<100; n++) {
    await cycle();
    if (row(opId)?.status === expected) return;
    if (row(opId)?.status === 'FAILED') throw new Error(`${opId}: ${row(opId).error_message}`);
  }
  throw new Error(`${opId} did not reach ${expected}: ${JSON.stringify(db.all('SELECT op_id,status,error_message FROM sync_queue'))}`);
}
const id = (suffix: string) => `STAGING_POS_OUTBOX_${suffix}`;
let receipt = 100000;
function sale(suffix: string, localShiftId: string | null, quantity = 1, targetRepos = repos) {
  const orderId=id(`ORDER_${suffix}`), paymentId=id(`PAYMENT_${suffix}`), amount=fixture.priceCents*quantity;
  savePosSale(targetRepos, {
    order: { id:orderId, restaurant_id:auth.restaurantId, branch_id:auth.branchId, employee_id:auth.employeeId,
      shift_id:localShiftId, order_type:'TAKEAWAY', order_number:`#${++receipt}`, source:'POS', status:'COMPLETED', payment_status:'PAID',
      subtotal_cents:amount, discount_cents:0, tax_cents:0, total_cents:amount, tip_cents:0, idempotency_key:orderId },
    payment: { id:paymentId, order_id:orderId, restaurant_id:auth.restaurantId, branch_id:auth.branchId, employee_id:auth.employeeId,
      shift_id:localShiftId, method:'CASH', amount_cents:amount, currency:fixture.currency, status:'PAID', idempotency_key:paymentId },
    items: [{ id:id(`ITEM_${suffix}`), menu_item_id:fixture.menuItemId, name_snapshot:'Synthetic pastry', price_snapshot_cents:fixture.priceCents,
      quantity, subtotal_cents:amount, total_cents:amount, tax_cents:0, discount_cents:0 }],
  });
  return { orderId, paymentId, amount };
}
async function open(suffix: string) {
  const localId=id(`SHIFT_${suffix}`);
  await ipc('db:shifts:open', {id:localId,device_id:auth.deviceId,branch_id:auth.branchId,restaurant_id:auth.restaurantId,
    employee_id:auth.employeeId,opening_cash_cents:10000,idempotency_key:id(`OPEN_${suffix}`)});
  return localId;
}
async function close(localId: string) {
  await ipc('db:shifts:close', {id:localId,closing_cash_cents:10000});
  await until(`shift_close_${localId}`);
}
function serverPayment(paymentId: string) {
  const matches=inspect().payments.filter((p: any)=>p.idempotencyKey===`SYNC_PAYMENT:${auth.deviceId}:${paymentId}`);
  assert.equal(matches.length,1,'Exactly one persisted payment for the original key');return matches[0];
}
function serverShift(serverId: string) { const s=inspect().shifts.find((s:any)=>s._id===serverId);assert.ok(s);return s; }
async function completed(s: ReturnType<typeof sale>, shiftId?: string) {
  await until(`phpstg_completed_${s.orderId}`);
  const payment=serverPayment(s.paymentId);
  assert.equal(payment.amountCents,s.amount);assert.equal(payment.currency,'NGN');assert.equal(payment.method,'CASH');assert.equal(payment.status,'PAID');
  if (shiftId) assert.equal(payment.shiftId,shiftId);
  const order=inspect().orders.find((o:any)=>o._id===payment.orderId);
  assert.equal(order.idempotencyKey,`SYNC_ORDER:${auth.branchId}:${s.orderId}`);
  assert.equal(order.status,'COMPLETED');assert.equal(order.paymentStatus,'PAID');assert.equal(order.totalCents,s.amount);
  return payment;
}
const realFetch=globalThis.fetch;
const outgoing:any[]=[]; const openingKeys:string[]=[]; const responses:any[]=[];
let blockOpening=false, losePaymentId='', lostCommittedId='';
globalThis.fetch=(async (url:any, init:any) => {
  assert.ok(String(url).startsWith(base+'/'),'No non-staging HTTP is permitted');
  const body=JSON.parse(init.body);
  if (String(url).endsWith('/shifts/open')) {
    openingKeys.push(body.idempotencyKey);
    if(blockOpening) return new Response(JSON.stringify({error:{message:'Synthetic transport outage'}}),{status:503});
  }
  for(const command of body.commands || []) {
    outgoing.push(command);
    if(command.entityType==='PAYMENT') {
      for(const field of ['localShiftId','status','verificationSource','providerResponse','completedAt']) assert.equal(field in command.payload,false);
      assert.equal(command.payload.idempotencyKey,command.idempotencyKey);
    }
    if(command.entityType==='ORDER' && ['READY','COMPLETED'].includes(command.payload.status)) {
      const created=inspect().orders.find((o:any)=>o.idempotencyKey===`SYNC_ORDER:${auth.branchId}:${command.entityId}`);
      assert.equal(created?.paymentStatus,'PAID','Lifecycle may advance only after persisted PAID');
    }
  }
  const response=await realFetch(url, {...init, redirect:'error'});
  const result=await response.clone().json();responses.push(result);
  if(losePaymentId && body.commands?.some((c:any)=>c.entityType==='PAYMENT' && c.idempotencyKey===losePaymentId)) {
    assert.equal(response.ok,true);
    const payment=serverPayment(losePaymentId);lostCommittedId=payment._id;
    assert.ok(result.data.some((r:any)=>r.status==='SUCCESS' && r.entityId===lostCommittedId));
    losePaymentId='';await response.arrayBuffer();throw new Error('Synthetic lost response after verified server commit');
  }
  return response;
}) as typeof fetch;

async function deviceSale(deviceId: string, suffix: string, quantity: number, expected: 'DONE' | 'FAILED') {
  const localDb=new PosDatabase(':memory:');localDb.migrate();const localRepos=createRepos(localDb);
  const localAuth={...auth,deviceId,accessToken:token(deviceId)};localRepos.meta.setLastAuth(localAuth);
  const s=sale(suffix,null,quantity,localRepos);
  const localReader=new QueueReader(localRepos,localDb,new SyncHttpClient(base,()=>localAuth,true),deviceId,()=>localAuth,undefined,undefined,true);
  localReader.start();
  try {
    for(let i=0;i<100;i++) {
      localDb.run('UPDATE sync_queue SET next_attempt_at=0');await localReader.requestNow();
      await new Promise(resolve=>setTimeout(resolve,20));
      const state=localDb.get<any>('SELECT status FROM sync_queue WHERE op_id=?',`phpstg_completed_${s.orderId}`)?.status;
      if(state===expected) {
        assert.equal(localDb.get<any>('SELECT status FROM sync_queue WHERE op_id=?',`payment_${s.paymentId}`)?.status,'DONE');
        return;
      }
    }
    throw new Error(`Two-device stock scenario ${suffix} did not reach ${expected}`);
  } finally {localReader.stop();localDb.close();}
}

async function main() {
  const localA=await open('A');const first=sale('A',localA);
  assert.equal(JSON.parse(row(`payment_${first.paymentId}`).payload).localShiftId,localA);
  reader.start();await reader.requestNow();assert.equal(outgoing.length,0);assert.equal(openingKeys.length,0);
  online=true;
  await until(`shift_open_${localA}`);
  const serverA=repos.shifts.getById(localA)?.serverShiftId;assert.ok(serverA);assert.notEqual(serverA,localA);
  assert.equal(serverShift(serverA).status,'OPEN');
  // A fresh repository/reader resolves the persisted response, not an in-memory cache.
  reader.stop();reader=new QueueReader(createRepos(db),db,client,auth.deviceId,getAuth,undefined,undefined,true);
  losePaymentId=first.paymentId;reader.start();
  await until(`payment_${first.paymentId}`,'RETRYING');
  assert.equal(serverPayment(first.paymentId)._id,lostCommittedId);
  const paid=await completed(first,serverA);assert.equal(paid._id,lostCommittedId);
  const attempts=outgoing.filter(c=>c.entityType==='PAYMENT' && c.idempotencyKey===first.paymentId);
  assert.ok(attempts.length>=2);assert.deepEqual(attempts[0],attempts[1]);assert.equal(attempts[0].payload.shiftId,serverA);
  assert.ok(responses.some(r=>Array.isArray(r.data)&&r.data.some((v:any)=>v.idempotencyKey===first.paymentId && v.resultCode==='ALREADY_APPLIED' && v.entityId===paid._id)));
  const flow=outgoing.filter(c=>c.entityId===first.orderId||c.entityId===first.paymentId).map(c=>c.entityType==='PAYMENT'?'PAYMENT':c.operation==='CREATE'?'ORDER':c.payload.status);
  assert.deepEqual(flow,['ORDER','PAYMENT','PAYMENT','READY','COMPLETED']);
  console.log(JSON.stringify({shiftA:{localShiftId:localA,serverShiftAId:serverA,outgoingPaymentShiftId:attempts[0].payload.shiftId},lostResponse:{sameKey:true,paymentCount:1,originalResultReplayed:true}}));

  await close(localA);const localB=await open('B');await until(`shift_open_${localB}`);
  const serverB=repos.shifts.getById(localB)?.serverShiftId;assert.ok(serverB);assert.notEqual(serverB,serverA);
  assert.equal(serverShift(serverA).status,'CLOSED');const beforeB=serverShift(serverB);assert.equal(beforeB.status,'OPEN');
  // Recreate a delayed offline sale using the original local association and its known server mapping.
  const delayed=sale('DELAYED_A',localA);await completed(delayed,serverA);
  assert.equal(serverShift(serverA).status,'CLOSED');assert.deepEqual(serverShift(serverB),beforeB);
  console.log(JSON.stringify({closedShift:{shiftA:'CLOSED',shiftB:'OPEN',shiftBUnchanged:true,delayedPaymentShiftId:serverPayment(delayed.paymentId).shiftId,serverShiftBId:serverB}}));

  await close(localB);blockOpening=true;
  const localC=await open('FAULT');const dependent=sale('DEPENDENT',localC);const unrelated=sale('UNRELATED',localA);
  await completed(unrelated,serverA);
  assert.equal(repos.shifts.getById(localC)?.serverShiftId,undefined);
  assert.equal(row(`payment_${dependent.paymentId}`).status,'QUEUED');
  assert.equal(outgoing.some(c=>c.entityType==='PAYMENT'&&c.idempotencyKey===dependent.paymentId),false);
  assert.ok(openingKeys.filter(k=>k===row(`shift_open_${localC}`).idempotency_key).length>0);
  blockOpening=false;await until(`shift_open_${localC}`);
  const serverC=repos.shifts.getById(localC)?.serverShiftId;assert.ok(serverC);await completed(dependent,serverC);
  assert.ok(openingKeys.filter(k=>k===row(`shift_open_${localC}`).idempotency_key).length>=2);
  console.log(JSON.stringify({faultInjection:{dependentHeld:true,unrelatedCompleted:true,sameOpenKey:true,samePaymentKey:true,resolvedShiftId:serverC}}));
  await close(localC);

  // Preserve the prior harness's validation and authorization checks using the current contract.
  const invalid=(suffix:string,operation:string,payload:any)=>({opId:id(suffix),idempotencyKey:id(suffix),entityType:'ORDER' as const,operation:operation as any,entityId:id(suffix),localEntityVersion:1,payload});
  const direct=(c:any,a:any=auth)=>new SyncHttpClient(base,()=>a,true).postBatch([c]);
  assert.equal((await direct(invalid('BAD_PAYLOAD','CREATE',{}))).results[0].resultCode,'VALIDATION_ERROR');
  assert.equal((await direct(invalid('BAD_OPERATION','DELETE',{}))).results[0].resultCode,'VALIDATION_ERROR');
  for(const a of [{...auth,accessToken:'invalid'},{...auth,accessToken:undefined},{...auth,deviceId:'STAGING_UNREGISTERED_DEVICE'},
    {...auth,branchId:'STAGING_OTHER_BRANCH'},{...auth,restaurantId:'STAGING_OTHER_RESTAURANT'}]) {
    await assert.rejects(()=>direct(invalid('BAD_AUTH','CREATE',{}),a),(e:any)=>e instanceof ApiError&&e.statusCode===(a.accessToken ? 403 : 401));
  }
  const providerKey=id('PROVIDER');
  assert.equal((await direct({opId:providerKey,idempotencyKey:providerKey,entityType:'PAYMENT',operation:'CREATE',entityId:providerKey,localEntityVersion:1,
    payload:{orderId:first.orderId,method:'ONLINE_PAYSTACK',amountCents:fixture.priceCents,idempotencyKey:providerKey}})).results[0].resultCode,'UNSUPPORTED_OFFLINE_OPERATION');
  await deviceSale(auth.deviceId,'SUFFICIENT_A',3,'DONE');
  await deviceSale(fixture.otherDeviceId,'SUFFICIENT_B',4,'DONE');
  inspect('low-stock');
  await deviceSale(auth.deviceId,'LOW_A',3,'DONE');
  await deviceSale(fixture.otherDeviceId,'LOW_B',4,'FAILED');
  console.log('PASS: retained two-device stock success/conflict and provider rejection checks.');
  console.log('PASS: connected SQLite → HTTP → PHP → MongoDB shift attribution, lifecycle, closed-shift isolation, fault recovery, lost-response idempotency, validation and authorization.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{globalThis.fetch=realFetch;reader.stop();db.close();});
