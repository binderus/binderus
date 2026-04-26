import React from 'react';
import ReactDOM from 'react-dom/client';
import { attachConsole } from '@tauri-apps/plugin-log';
import App from './App';
import { AppContextProvider } from './app/hooks/use-app-context';
import './index.css';
import 'react-toastify/dist/ReactToastify.css';

// Mirror Rust-side `log::info!` / `log::warn!` output into the browser DevTools
// console so debugging across the boundary is one-screen. To write FROM JS into
// the log file, import `info/warn/error` from `@tauri-apps/plugin-log` (or the
// thin wrappers in `src/app/utils/log.ts`). Cheap no-op in web builds.
void attachConsole().catch(() => { /* non-Tauri context */ });

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppContextProvider>
      <App />
    </AppContextProvider>
  </React.StrictMode>
);
