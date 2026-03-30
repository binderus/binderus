import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppContextProvider } from './app/hooks/use-app-context';
import './index.css';
import 'react-toastify/dist/ReactToastify.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppContextProvider>
      <App />
    </AppContextProvider>
  </React.StrictMode>
);
