import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import './styles.css';

if (window.top !== window.self) {
  document.body.innerHTML =
    '<div class="boot">nudger cannot be embedded in another page. Open it directly.</div>';
  throw new Error('nudger cannot be embedded');
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
