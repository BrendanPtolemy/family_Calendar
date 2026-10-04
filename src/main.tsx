import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FamilyProvider } from './family';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FamilyProvider>
      <App />
    </FamilyProvider>
  </StrictMode>,
);
