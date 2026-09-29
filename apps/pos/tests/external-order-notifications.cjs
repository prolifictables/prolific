// Exercise the actual component callback without React, network, or database writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = ts.createSourceFile('CashierScreenLayout.tsx', fs.readFileSync(path.join(__dirname, '../src/components/pos/CashierScreenLayout.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'detectAndQueueExternalOrders') callback = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback);
const compiled = ts.transpileModule(`const detect = ${callback}`, {compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
function harness() {
  let cards = [], bells = 0, toasts = 0;
  const context = {seenExternalOrderIdsRef:{current:new Set()},initialHydrationDoneRef:{current:false},
    setIncomingWebOrders: update => { cards = update(cards); },playOrderBell:()=>bells++,flashToast:()=>toasts++};
  vm.createContext(context);
  vm.runInContext(compiled + '\nthis.detect = detect;', context);
  return {poll:context.detect, clear:()=>{cards=[]}, ids:()=>Array.from(cards,x=>x.id), bells:()=>bells, toasts:()=>toasts};
}
const order = (id, paymentStatus='UNPAID', sourceChannel='QR') => ({id,paymentStatus,sourceChannel});
const h=harness(), old=order('old');
h.poll([old]); assert.deepEqual(h.ids(),[]); assert.equal(h.bells(),0);
h.poll([old]); assert.deepEqual(h.ids(),[]);
const fresh=order('new','PARTIALLY_PAID','TABLE');
h.poll([old,fresh,fresh]); assert.deepEqual(h.ids(),['new']); assert.equal(h.bells(),1); assert.equal(h.toasts(),1);
h.clear(); h.poll([old,fresh]); assert.deepEqual(h.ids(),[]); assert.equal(h.bells(),1);
h.poll([]); h.poll([fresh]); assert.deepEqual(h.ids(),[]);
h.poll([order('paid','PAID'),order('refund','REFUNDED'),order('partial-refund','PARTIALLY_REFUNDED'),order('pos','UNPAID','POS')]);
assert.deepEqual(h.ids(),[]); assert.equal(h.bells(),1);
h.poll([order('paid','UNPAID')]); assert.deepEqual(h.ids(),[]);
h.poll([{id:'web',paymentStatus:'unpaid',source:'WEB'}]);assert.deepEqual(h.ids(),['web']);assert.equal(h.bells(),2);
const empty=harness();empty.poll([]);empty.poll([old]);assert.deepEqual(empty.ids(),['old']);
const remount=harness();remount.poll([old,fresh]);assert.deepEqual(remount.ids(),[]);assert.equal(remount.bells(),0);
console.log('PASS: silent baseline, stable IDs, duplicate batches, dismissal, status changes, paid/refunded exclusion, remount, and empty baseline.');

// Exercise the same async tick used by both interval and socket callbacks.
let tickSource;
function findTick(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'doTick') tickSource=node.getText(source);
  ts.forEachChild(node,findTick);
}
findTick(source);
assert.ok(tickSource);
(async()=>{
  let tableReads=0, orderReads=0, notifications=0, release;
  const gate=new Promise(resolve=>{release=resolve});
  const ctx={alive:true,bootstrapComplete:false,tickInFlight:false,
    window:{electronAPI:{db:{tables:{list:async()=>{tableReads++;await gate;return []}},orders:{listRecent:async()=>{orderReads++;return []}}}}},
    setTables:()=>{},setConnection:()=>{},setOrders:()=>{},setTableSessions:()=>{},
    hydrateOrders:async rows=>rows,detectAndQueueExternalOrders:()=>notifications++};
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(tickSource,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,ctx);
  await ctx.doTick();assert.equal(tableReads,0,'startup must establish baseline first');
  ctx.bootstrapComplete=true;
  const first=ctx.doTick();await ctx.doTick();assert.equal(tableReads,1,'overlapping tick must be skipped');
  release();await first;assert.equal(orderReads,1);assert.equal(notifications,1);assert.equal(ctx.tickInFlight,false);
  await ctx.doTick();assert.equal(orderReads,2,'next interval must still run');
  ctx.alive=false;await ctx.doTick();assert.equal(orderReads,2,'discarded mount must stop polling');
  console.log('PASS: startup/interval serialization, concurrent ticks, next-tick recovery, and cleanup guard.');
})().catch(error=>{console.error(error);process.exitCode=1});
