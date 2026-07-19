import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Граница ошибок: без неё исключение в рендере оставляет пользователя
 * с пустым чёрным экраном и без единой подсказки, что делать.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Ошибка интерфейса:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-semibold">Что-то пошло не так</h1>
        <p className="text-sm text-ink-muted">
          Интерфейс не смог отрисоваться. Данные в безопасности — попробуйте перезагрузить.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand px-5 font-semibold text-brand-ink"
        >
          <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />
          Перезагрузить
        </button>
        <p className="text-xs text-ink-faint">{error.message}</p>
      </main>
    );
  }
}
