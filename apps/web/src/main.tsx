import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { initTelegram } from './shared/lib/telegram';
import './styles/index.css';

// Инициализируем Mini App до первого рендера: иначе видно «прыжок» высоты вьюпорта.
initTelegram();

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
