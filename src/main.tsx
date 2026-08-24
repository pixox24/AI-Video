import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Prevent uncaught errors from breaking runtime unexpectedly
window.addEventListener('unhandledrejection', (event) => {
  console.warn('[Global Safe Handler] Unhandled promise rejection intercepted:', event.reason);
  // Prevent default console spam/fatal crash
  event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

