const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const parse=p=>ts.createSourceFile(p,fs.readFileSync(path.join(root,p),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const find=(n,p)=>p(n)?n:ts.forEachChild(n,c=>find(c,p));
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const layout=parse('src/components/pos/CashierScreenLayout.tsx');
const button=find(layout,n=>ts.isJsxAttribute(n)&&n.name.getText(layout)==='onClick'&&n.getText(layout).includes('_customerDisplayWindow'));
assert.ok(button);
const callback=button.initializer.expression.getText(layout);
for(const pathname of ['/POS/','/POS/index.html','/']) {
 let url,idle=0;const popup={closed:false,addEventListener(){},focus(){}};
 const ctx={_customerDisplayWindow:null,screen:{width:1920,height:1080},flashToast(){},window:{location:{pathname},open:u=>{url=u;return popup},setInterval(){},clearInterval(){},electronAPI:{customerDisplay:{showIdle:async()=>{idle++}}}}};
 vm.runInNewContext(compile(`(${callback})()`),ctx);
 assert.equal(url,pathname+'#/customer-display');assert.equal(idle,0);
 vm.runInNewContext(compile(`(${callback})()`),ctx);assert.equal(idle,0,'refocusing must retain cart');
}
const shim=parse('src/lib/mock-electron-shim.ts');
const functions=['getCustomerChannel','emitCustomerState'].map(name=>find(shim,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(shim)).join('\n');
function harness(hash){
 const posts=[];let receiver;
 const context={window:{location:{hash}},CUSTOMER_CHANNEL_NAME:'test',_customerChannel:null,_customerSubscribers:[],_latestCustomerState:{screen:'idle'},BroadcastChannel:class{constructor(){receiver=this}postMessage(m){posts.push(m)}}};
 vm.createContext(context);vm.runInContext(compile(functions),context);context.getCustomerChannel();
 return {context,posts,receive:m=>receiver.onmessage({data:m})};
}
const cashier=harness('#/pos');cashier.context.emitCustomerState({screen:'order',orderPreview:{totalCents:400000}});
cashier.receive({type:'customer-latest-request'});assert.equal(cashier.posts.at(-1).payload.screen,'order');
const popup=harness('#/customer-display');popup.receive({type:'customer-latest-request'});assert.equal(popup.posts.length,0);
popup.receive(cashier.posts.at(-1));popup.context.emitCustomerState({branding:{name:'Brand'}});
assert.equal(popup.posts.length,0,'popup bootstrap must not overwrite cashier state');
assert.equal(popup.context._latestCustomerState.orderPreview.totalCents,400000);
console.log('PASS: subdirectory popup URLs, cart preserved on open/refocus, cashier replay, and subscriber-only popup branding.');
