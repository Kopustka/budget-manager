import { useEffect } from 'react';
import { useBudgetStore } from '@/stores/useBudgetStore';
import { Toaster } from '@/shared/ui/Toaster';
import { HomeScreen } from './screens/HomeScreen';
import { DndMatrixProvider } from '@/features/dnd-matrix/DndMatrixProvider';

export function App() {
  const load = useBudgetStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  // Фон не дублируем на обёртке: он на body — иначе перекроет амбиентные градиенты.
  return (
    <div className="min-h-full text-ink">
      <Toaster />
      <DndMatrixProvider>
        <HomeScreen />
      </DndMatrixProvider>
    </div>
  );
}
