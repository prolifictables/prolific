const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname,'..');
let persisted, rotations=0;
global.localStorage = {getItem:()=>null,setItem(){},removeItem(){}};
global.window = {location:{hostname:'',origin:'null'},localStorage:global.localStorage,electronAPI:{
  isNativeDesktop:true,getApiBaseUrlSync:()=> 'http://127.0.0.1:1/api/v1',
  getDeviceId:async()=>({deviceId:'device_test'}),
  authRefresh:async()=>{rotations++;await new Promise(resolve=>setImmediate(resolve));return {accessToken:'new-synthetic',refreshToken:'new-refresh',expiresIn:900}},
  db:{meta:{setLastAuth:async value=>{persisted=value}}},
}};
global.fetch=async()=>{throw new Error('Network is forbidden in this test')};
const result=buildSync({stdin:{contents:`export {useAuthStore} from './src/lib/auth-store'; export {resolveDefaultBranchId} from './src/lib/remote-menu'; export {isWebPhpMode,isPhpPosMode} from './src/lib/web-php-config';`,resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',logLevel:'silent',
 define:{'import.meta.env':JSON.stringify({VITE_WEB_PHP_MODE:'1',VITE_DEFAULT_BRANCH_ID:'wrong-default'})}});
const filename=path.join(__dirname,'renderer-contracts-bundle.cjs');const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(__dirname);mod._compile(result.outputFiles[0].text,filename);
const {useAuthStore,resolveDefaultBranchId,isWebPhpMode,isPhpPosMode}=mod.exports;
(async()=>{
 assert.equal(isWebPhpMode(),false);assert.equal(isPhpPosMode(),true);
 const actions=useAuthStore.getState().actions;
 actions.setOnlineLogin({employee:{id:'employee_test',branchId:'branch_test'},branch:{id:'branch_test'},restaurant:{id:'restaurant_test'},deviceId:'device_test',accessToken:'old-synthetic',refreshToken:'old-refresh',expiresIn:-1});
 assert.equal(await resolveDefaultBranchId(),'branch_test');
 await Promise.all([actions.refreshAccessToken(),actions.refreshAccessToken()]);
 assert.equal(rotations,1);assert.equal(persisted.employeeId,'employee_test');assert.equal(persisted.branchId,'branch_test');assert.equal(persisted.restaurantId,'restaurant_test');assert.equal(persisted.deviceId,'device_test');
 actions.setOfflinePinLogin({id:'employee_test'},{id:'branch_test',restaurant:{id:'restaurant_test'}});
 assert.equal(persisted.mode,'OFFLINE_PIN');assert.equal(persisted.accessToken,undefined);assert.equal(useAuthStore.getState().accessToken,undefined);
 console.log('PASS: native/browser separation, authenticated branch over defaults, shared refresh rotation preserves scope, offline login has no server token.');
})().catch(e=>{console.error(e);process.exitCode=1});
