// Runs actual editor/save callbacks and HTTP client with an in-memory transport.
// No requests or database connections leave this process.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const source = ts.createSourceFile('ManagerTools.tsx', fs.readFileSync(path.join(root, 'src/components/pos/ManagerTools.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
const editor = find(source, n => ts.isFunctionDeclaration(n) && n.name?.text === 'ItemEditor');
const variable = (scope, name) => find(scope, n => ts.isVariableDeclaration(n) && n.name.getText(source) === name).initializer.getText(source);
const submit = variable(editor, 'submit');
const save = variable(source, 'handleSaveItem');
const initialPrice = find(editor, n => ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.name.elements[0].name?.getText(source) === 'priceNgn').initializer.arguments[0].getText(source);
const evaluate = (code, context) => vm.runInNewContext(ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2020}}).outputText, context);
const bundle = buildSync({entryPoints:[path.join(root, 'src/lib/remote-menu-admin.ts')],bundle:true,write:false,format:'cjs',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_API_MODE:'php',VITE_API_BASE_URL:'https://prolifictables.com/api/v1'})}}).outputFiles[0].text;

async function scenario({price='4000', reject=false, php=true}={}) {
  const state = {price:350000, requests:[], cached:[], closed:false, alerts:[], queued:[], refresh:0};
  const transport = {module:{exports:{}},console,setTimeout,clearTimeout,AbortController,Response,localStorage:{getItem:()=>null},fetch:async(url, init)=>{
    state.requests.push({url,method:init.method,body:JSON.parse(init.body)});
    if (reject) return new Response(JSON.stringify({error:{message:'Price update rejected'}}),{status:422});
    state.price = JSON.parse(init.body).price;
    return new Response(JSON.stringify({success:true,data:{id:'meal',name:'Meal',categoryId:'category',price:state.price}}));
  }};
  vm.runInNewContext(bundle,transport);
  const snap = {categories:[],items:[{id:'meal',price:350000}],modifiers:[]};
  const context = {
    isWebPhpMode:()=>php,itemEditing:{id:'meal',price:350000},branchId:'branch',restaurantId:'restaurant',
    updateAdminMenuItem:transport.module.exports.updateAdminMenuItem,resolveToken:async()=>'test-only',callOpts:()=>({}),normItem:x=>x,
    setItemSaving:()=>{},setItemEditorOpen:x=>{state.closed=!x},setItemEditing:()=>{},
    window:{electronAPI:{db:{menuItems:{upsert:async row=>{state.cached.push(row)}}}},localStorage:{getItem:()=>null,setItem:()=>{}}},
    readLocalStorageSnapshot:()=>snap,OFFLINE_MENU_KEY:'test',applyRemoteMenuSnapshot:()=>{},
    pushSyncQueue:async command=>{state.queued.push(command)},onMenuChanged:async()=>{state.refresh++},refreshItems:async()=>{},
    triggerCrossTally:async()=>{},online:true,flashToast:()=>{},alert:message=>{state.alerts.push(message)},
  };
  evaluate(`this.save = ${save}`,context);
  let pending;
  const form = {editing:{price:350000},priceNgn:price,name:'Meal',categoryId:'category',description:'',imageUrl:'',status:'AVAILABLE',sortOrder:0,selectedMods:new Set(),isWebPhpMode:()=>php,setErrors:errs=>{state.errors=errs},onSave:input=>{pending=context.save(input)}};
  assert.equal(evaluate(initialPrice,form),'3500');
  evaluate(`(${submit})()`,form);
  await pending;
  return state;
}
(async()=>{
  const s=await scenario();
  assert.equal(s.requests.length,1);
  assert.equal(s.requests[0].method,'PATCH');
  assert.ok(s.requests[0].url.endsWith('/api/v1/menu/items/meal'));
  assert.equal(s.requests[0].body.price,400000);
  assert.equal(s.price,400000);
  assert.equal(s.cached[0].price/100,4000);
  assert.equal(s.queued.length,0);
  assert.equal(s.closed,true);
  assert.equal(s.refresh,1);
  const failed=await scenario({reject:true});
  assert.equal(failed.price,350000);
  assert.equal(failed.cached.length,0);
  assert.equal(failed.closed,false);
  assert.equal(failed.alerts.length,1);
  for (const price of ['0','-1','invalid','10000000.01']) {
    const invalid=await scenario({price});
    assert.equal(invalid.requests.length,0);
    assert.ok(invalid.errors.price);
  }
  const desktop=await scenario({php:false});
  assert.equal(desktop.requests.length,0);
  assert.equal(desktop.queued[0].payload.price,400000);
  console.log('PASS: ₦3,500 → ₦4,000 serializes PATCH price=400000, caches server result, refreshes, rejects invalid/failed saves, and preserves non-PHP sync.');
})().catch(error=>{console.error(error);process.exitCode=1});
