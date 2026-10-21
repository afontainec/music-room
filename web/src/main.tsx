import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The shared tokens come first, so page stylesheets (imported through App) build on them.
import './tokens.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
