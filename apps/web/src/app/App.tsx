import { useEffect } from 'react';
import { LayoutGrid, PieChart, Settings, ListOrdered } from 'lucide-react';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useUiStore, type Tab } from '@/stores/useUiStore';
import { Toaster } from '@/shared/ui/Toaster';
import { HomeScreen } from './screens/HomeScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { AnalyticsScreen } from './screens/AnalyticsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DndMatrixProvider } from '@/features/dnd-matrix/DndMatrixProvider';
import { Numpad } from '@/features/tx-editor/Numpad';
import { haptics } from '@/shared/lib/telegram';
import { cn } from '@/shared/ui/cn';
import { ScreenSwitcher } from './ScreenSwitcher';

const TABS: Array<{ id: Tab; label: string; icon: typeof LayoutGrid }> = [
  { id: 'home', label: 'Главная', icon: LayoutGrid },
  { id: 'history', label: 'История', icon: ListOrdered },
  { id: 'analytics', label: 'Аналитика', icon: PieChart },
  { id: 'settings', label: 'Настройки', icon: Settings },
];

/** Порядок вкладок = порядок панели снизу: из него берётся сторона выезда. */
const TAB_ORDER = TABS.map((t) => t.id);

function renderScreen(tab: Tab) {
  switch (tab) {
    case 'home':
      return (
        <DndMatrixProvider>
          <HomeScreen />
        </DndMatrixProvider>
      );
    case 'history':
      return <HistoryScreen />;
    case 'analytics':
      return <AnalyticsScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

export function App() {
  const load = useBudgetStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const tab = useUiStore((s) => s.tab);
  const setTab = useUiStore((s) => s.setTab);

  useEffect(() => {
    // Настройки — раньше данных: из них берётся валюта для всего форматирования сумм.
    void loadSettings();
    void load();
  }, [load, loadSettings]);

  // Фон не дублируем на обёртке: он на body — иначе перекроет амбиентные градиенты.
  return (
    <div className="min-h-full text-ink">
      <Toaster />

      {/* Переход между вкладками — «листание окон» с направлением по порядку
          панели снизу. Отступ снизу под фиксированную панель — на слое экрана
          внутри ScreenSwitcher (pb-24), иначе она закрывает конец списка. */}
      <ScreenSwitcher activeKey={tab} order={TAB_ORDER} render={renderScreen} />

      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-canvas/80 backdrop-blur-xl"
      >
        {/* Четыре пункта: gap уже, чем на двух, иначе «Аналитика» переносится */}
        <div className="mx-auto flex max-w-md gap-1 px-2 pt-1 pb-safe">
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
                  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px]',
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

      {/* Экранная клавиатура сумм — одна на всё приложение, поверх любой шторки */}
      <Numpad />
    </div>
  );
}
