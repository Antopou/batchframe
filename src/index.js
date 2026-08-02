import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Window controls sit on the left on macOS and on the right on Windows, so the
// header needs to know which it is padding around. Absent outside Electron.
const platform = window.electronAPI && window.electronAPI.platform;
if (platform) {
  document.documentElement.dataset.platform = platform;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
