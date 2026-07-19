import type { BotAlert } from '../modules/alerts/alerts.types.js';

/** Форматирование сумм для бота: минорные единицы → «1 234 ₽». */
export function money(minor: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/**
 * Текст пуша. Каждое уведомление отвечает на «что случилось» и «что с этим
 * делать» — иначе оно превращается в шум, который отключают.
 */
export function renderAlert(alert: BotAlert): string {
  switch (alert.kind) {
    case 'overdraft':
      return [
        `🔴 <b>Лимит превышен</b>`,
        `«${alert.categoryName}»: ${money(alert.spent)} из ${money(alert.limit)}.`,
        `Перерасход — ${money(alert.spent - alert.limit)}.`,
      ].join('\n');

    case 'limit_reached':
      return [
        `🟠 <b>Лимит исчерпан</b>`,
        `«${alert.categoryName}»: потрачено ${money(alert.spent)} из ${money(alert.limit)}.`,
        `До конца периода лучше не тратить по этой категории.`,
      ].join('\n');

    case 'fast_pace':
      return [
        `⚡️ <b>Тратите быстрее обычного</b>`,
        `Сегодня — ${money(alert.spentToday)} при равномерной норме ${money(alert.dailyBudget)} в день.`,
      ].join('\n');

    case 'evening_reminder':
      return [
        `🌙 <b>Запишите траты за день</b>`,
        `Пары минут хватит, чтобы месяц сошёлся.`,
      ].join('\n');
  }
}
