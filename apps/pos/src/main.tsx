import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { installMockElectronAPI } from './lib/mock-electron-shim';
import { useAuthStore } from './lib/auth-store';

// Install mock Electron API shim when running in browser (no real Electron preload)
// This lets POS login / menu / tables / orders / payments all work end-to-end during dev.
installMockElectronAPI();
useAuthStore.persist.rehydrate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
