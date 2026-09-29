// Run with ELECTRON_RUN_AS_NODE=1 <project Electron binary> tests/desktop-sync-loop.cjs.
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
const { SyncEngine } = load('electron/main/sync/index.ts');
const auth={accessToken:'synthetic',deviceId:'test_device',branchId:'test_branch',restaurantId:'test_restaurant',employeeId:'test_employee'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function scenario(kind) {
 const db=new PosDatabase(':memory:');db.migrate();const repos=createRepos(db);
 const payload=kind==='blocked'?{orderId:'missing_order'}:{source:'POS'};
 const saved={op_id:'test_op',entity_type:kind==='blocked'?'PAYMENT':kind==='unsupported'?'MENU_ITEM':'ORDER',operation:'CREATE',entity_id:'test_entity',payload:JSON.stringify(payload),idempotency_key:'stable_key',local_entity_version:1,status:kind==='failed'?'FAILED':kind==='future'?'RETRYING':'QUEUED',next_attempt_at:kind==='future'?Date.now()+60000:null};
 repos.syncQueue.push(saved);
 const events=[];let sends=0;let engine;
 engine=new SyncEngine({repos,db,httpBaseUrl:'http://127.0.0.1:1/api/v1',getAuthFn:()=>auth,deviceId:auth.deviceId,phpStagingSync:true,ipcMain:{handle(){}},onStatusChange:s=>{
  events.push(s);if(events.length>40)engine.stop(); // Stop an old-code microtask loop deterministically.
 }});
 engine.httpClient.pingHealth=async()=>true;
 engine.httpClient.postBatch=async commands=>{sends++;return {results:commands.map(c=>({opId:c.opId,status:'SUCCESS',responseSnapshot:{id:c.entityId}}))};};
 try {
  engine.start();await flush();await flush();
  assert.ok(events.length<10,kind+': idle status feedback loop');
  assert.equal(sends,0,kind+': no ineligible requests');
  assert.equal(events.includes('SYNCHRONIZING'),false,kind+': no false syncing indicator');
  const row=db.get('SELECT * FROM sync_queue WHERE op_id=?','test_op');
  assert.equal(row.idempotency_key,saved.idempotency_key);assert.equal(row.payload,saved.payload);
  assert.notEqual(row.status,'DONE');
  // A real eligible command must still flush on a successful health check.
  repos.syncQueue.push({op_id:'ready',entity_type:'ORDER',operation:'CREATE',entity_id:'ready',payload:JSON.stringify({source:'POS'}),idempotency_key:'ready_key',local_entity_version:1});
  engine.monitor.setStatus('ONLINE','health-ping-ok');await flush();await flush();
  assert.equal(db.get("SELECT status FROM sync_queue WHERE op_id='ready'").status,'DONE');
  assert.equal(sends,1);assert.ok(events.includes('SYNCHRONIZING'));
  const count=events.length;await flush();assert.equal(events.length,count,'successful batch must settle');
 } finally {engine.stop();await flush();db.close();}
}
(async()=>{for(const kind of ['future','blocked','unsupported','failed'])await scenario(kind);console.log('PASS: no sync feedback loop for deferred, blocked, unsupported or failed queues; eligible work still flushes on health recovery; payloads and keys preserved.');})().catch(e=>{console.error(e);process.exitCode=1;});
