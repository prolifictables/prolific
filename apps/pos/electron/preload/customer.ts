import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('customerWindowAPI', {
  getVersions: () => ipcRenderer.invoke('app:get-versions'),

  subscribeCustomerState: (cb: (state: unknown) => void) =>
    ipcRenderer.on('customer:state-changed', (_e, s) => cb(s)),

  unsubscribeCustomerState: () =>
    ipcRenderer.removeAllListeners('customer:state-changed'),

  getRestaurantBranding: () => ipcRenderer.invoke('customer:get-branding'),
});

export type CustomerWindowAPI = typeof window.customerWindowAPI;
