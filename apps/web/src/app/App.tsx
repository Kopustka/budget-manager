import { useEffect, useState } from 'react';
import { LayoutGrid, PieChart } from 'lucide-react';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { Toaster } from '@/shared/ui/Toaster';
import { HomeScreen } from './screens/HomeScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { DndMatrixProvider } from '@/features/dnd-matrix/DndMatrixProvider';
import { haptics } from '@/shared/lib/telegram';
import { cn } from '@/shared/ui/cn';

type Tab = 'home' | 'analytics';

const TABS: Array<{ id: Tab; label: string; icon: typeof LayoutGrid }> = [
  { id: 'home', label: 'Главная', icon: LayoutGrid },
  { id: 'analytics', label: 'Аналитика', icon: PieChart },
];

export function App() {
  const load = useBudgetStore((s) => s.load);
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => {
    void load();
  }, [load]);

  // Фон не дублируем на обёртке: он на body — иначе перекроет амбиентные градиенты.
  return (
    <div className="min-h-full text-ink">
      <Toaster />

      {/* Отступ снизу — под фиксированную панель, иначе она закрывает конец списка */}
      <div className="pb-24">
        {tab === 'home' ? (
          <DndMatrixProvider>
            <HomeScreen />
          </DndMatrixProvider>
        ) : (
          <AnalyticsScreen />
        )}
      </div>

      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/80 backdrop-blur-xl"
      >
        <div className="mx-auto flex max-w-md gap-2 px-4 pt-1 pb-safe">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  haptics.selection();
                  setTab(id);
                }}
                className={cn(
                  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px]',
                  'transition-colors duration-[var(--duration-fast)]',
                  active ? 'text-brand' : 'text-ink-faint',
                )}
              >
                <Icon size={22} strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
