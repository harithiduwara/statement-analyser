// First import in the app: the shims must be installed before pdf.js, or
// anything else that assumes a current browser, is evaluated.
import './parsing/compat.js';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
