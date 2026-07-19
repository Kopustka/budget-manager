import type { BotAlert } from '../modules/alerts/alerts.types.js';

/** Форматирование сумм для бота: минорные единицы → «1 234 ₽» в валюте пользователя. */
export function money(minor: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
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
        `«${alert.categoryName}»: ${money(alert.spent, alert.currency)} из ${money(alert.limit, alert.currency)}.`,
        `Перерасход — ${money(alert.spent - alert.limit, alert.currency)}.`,
      ].join('\n');

    case 'limit_reached':
      return [
        `🟠 <b>Лимит исчерпан</b>`,
        `«${alert.categoryName}»: потрачено ${money(alert.spent, alert.currency)} из ${money(alert.limit, alert.currency)}.`,
        `До конца периода лучше не тратить по этой категории.`,
      ].join('\n');

    case 'fast_pace':
      return [
        `⚡️ <b>Тратите быстрее обычного</b>`,
        `Сегодня — ${money(alert.spentToday, alert.currency)} при равномерной норме ${money(alert.dailyBudget, alert.currency)} в день.`,
      ].join('\n');

    case 'evening_reminder':
      return [
        `🌙 <b>Запишите траты за день</b>`,
        `Пары минут хватит, чтобы месяц сошёлся.`,
      ].join('\n');
  }
}
