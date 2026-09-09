import type { Transaction, Wallet } from '@budget/shared';

/**
 * Подпись перевода вида «Карта → Наличные».
 *
 * Живёт отдельно от экранов, потому что перевод показывают трое: главная,
 * «История» и шторка правки. Разъехавшиеся формулировки читались бы как разные
 * операции, хотя запись одна и та же.
 *
 * Удалённый кошелёк подписываем явно: transactions.wallet_id обнуляется вместе
 * с кошельком, и пустая половина стрелки выглядела бы как баг вёрстки.
 */
export function transferLabel(tx: Transaction, wallets: Wallet[]): string {
  const name = (id: string | null): string =>
    wallets.find((w) => w.id === id)?.name ?? 'удалённый кошелёк';
  return `${name(tx.walletId)} → ${name(tx.toWalletId)}`;
}
