// Runs the real login client with fake transport and an immediate failed wake.
// Never connects to a server or uses real credentials.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('esbuild');
const { loadEnv } = require('vite');
const root = path.resolve(__dirname, '..');
async function load(phpMode, ipcStatus, native = false) {
  const env = {...loadEnv('production', root, 'VITE_'), VITE_WEB_PHP_MODE: phpMode ? '1' : '0'};
  const built = await build({
    entryPoints:[path.join(root,'src/lib/remote-auth.ts')], bundle:true, write:false,
    format:'cjs', platform:'browser', define:{'import.meta.env':JSON.stringify(env)},
    plugins:[{name:'no-network-wake',setup(b){
      b.onResolve({filter:/^@prolific\/utils$/},()=>({path:'wake',namespace:'test'}));
      b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const isApiWakingResponse=()=>false; export const waitForApiWake=async()=>{throw new Error("test network unavailable")};'}));
    }}],
  });
  let ipcCalls=0, fetchCalls=0;
  const storage={getItem:()=>null};
  const context={module:{exports:{}},console,setTimeout,clearTimeout,AbortController,Response,
    localStorage:storage,fetch:async()=>{fetchCalls++;throw new TypeError('Failed to fetch')},
    window:{location:{hostname:'prolifictables.com'},localStorage:storage,electronAPI:{
      isNativeDesktop:native,
      getApiBaseUrlSync:()=> 'https://prolifictables.com/api/v1',
      authPinLogin:async()=>{ipcCalls++;return {status:ipcStatus,body:{data:{verified:true}}}},
    }},
  };
  vm.runInNewContext(built.outputFiles[0].text,context);
  return {login:context.module.exports.pinLogin,calls:()=>ipcCalls,fetchCalls:()=>fetchCalls};
}
(async()=>{
  const web=await load(true,-1);
  await assert.rejects(web.login({pin:'9876'}), /SERVER_UNREACHABLE/);
  assert.equal(web.calls(),0,'PHP browser must not retry through mock Electron');
  for(const status of [-1,0,NaN,199,600]) {
    const desktop=await load(false,status);
    await assert.rejects(desktop.login({pin:'9876'}), /SERVER_UNREACHABLE/);
    assert.equal(desktop.calls(),1);
  }
  const desktop=await load(false,200);
  assert.equal((await desktop.login({pin:'9876'})).verified,true);
  const native=await load(true,200,true);
  assert.equal((await native.login({pin:'9876',deviceId:'synthetic-device'})).verified,true);
  assert.equal(native.fetchCalls(),0,'Native PHP login must use IPC even with browser PHP build settings');
  assert.equal(native.calls(),1);
  console.log('PASS: PHP-web network failures preserve connection error; invalid IPC statuses cannot construct Response; valid desktop fallback still works.');
})().catch(error=>{console.error(error);process.exitCode=1});
