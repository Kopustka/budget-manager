import type { BotAlert, DailyDigestAlert } from '../modules/alerts/alerts.types.js';

/** Форматирование сумм для бота: минорные единицы → «1 234 ₽» в валюте пользователя. */
export function money(minor: number, currency = 'RUB'): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/** Пользовательский текст (категории, комментарии) идёт в parse_mode: 'HTML' — экранируем. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Строка про остаток бюджета. Без лимитов остатка не существует — молчим.
 * Обязательно со словом «бюджета»: это лимиты минус траты, а не деньги на
 * счетах — без уточнения читатель сверяет с балансом кошельков и видит «ошибку».
 */
function restLine(remaining: number | null | undefined, currency: string): string {
  if (remaining === null || remaining === undefined) return '';
  return remaining >= 0
    ? `Остаток бюджета на месяц: ${money(remaining, currency)}.`
    : `Перерасход бюджета за месяц: ${money(-remaining, currency)}.`;
}

/** Реальные деньги: сумма балансов кошельков на момент отправки. */
function walletsLine(total: number | undefined, currency: string): string {
  if (total === undefined) return '';
  return `💳 На счетах: ${money(total, currency)}.`;
}

/** Сколько трат перечислять построчно, прежде чем свернуть хвост в «…и ещё N». */
const DIGEST_SPENDS_MAX = 20;

/** Траты дня списком: «категория — сумма — на что потрачено». */
function spendLines(alert: DailyDigestAlert): string[] {
  const spends = alert.spends ?? [];
  const lines = spends.slice(0, DIGEST_SPENDS_MAX).map((s) => {
    const category = s.category ?? 'Без категории';
    const detail = [s.subcategory, s.comment].filter(Boolean).join(', ');
    return `• ${esc(category)} — ${money(s.amount, alert.currency)}${detail ? ` — ${esc(detail)}` : ''}`;
  });
  if (spends.length > DIGEST_SPENDS_MAX) {
    lines.push(`…и ещё ${spends.length - DIGEST_SPENDS_MAX} трат.`);
  }
  return lines;
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
        `«${esc(alert.categoryName)}»: ${money(alert.spent, alert.currency)} из ${money(alert.limit, alert.currency)}.`,
        `Перерасход — ${money(alert.spent - alert.limit, alert.currency)}.`,
      ].join('\n');

    case 'limit_reached':
      return [
        `🟠 <b>Лимит исчерпан</b>`,
        `«${esc(alert.categoryName)}»: потрачено ${money(alert.spent, alert.currency)} из ${money(alert.limit, alert.currency)}.`,
        `До конца периода лучше не тратить по этой категории.`,
      ].join('\n');

    case 'fast_pace':
      return [
        `⚡️ <b>Тратите быстрее обычного</b>`,
        `Сегодня — ${money(alert.spentToday, alert.currency)} при равномерной норме ${money(alert.dailyBudget, alert.currency)} в день.`,
      ].join('\n');

    case 'planned_due':
      return [
        `📅 <b>Завтра списание</b>`,
        `«${esc(alert.name)}» — ${money(alert.amount, alert.currency)}.`,
        `Убедитесь, что на кошельке хватает средств.`,
      ].join('\n');

    case 'daily_digest': {
      const currency = alert.currency;
      const spentToday = alert.spentToday ?? 0;

      // Ноль за день — это не «нечего сказать», а достижение: показываем серию,
      // ради которой за такими днями и следят.
      if (spentToday === 0) {
        const streak = alert.noSpendStreak ?? 0;
        return [
          `⭐️ <b>День без трат</b>`,
          streak > 1 ? `Подряд таких дней: ${streak}.` : `Сегодня вы ничего не потратили.`,
          restLine(alert.remaining, currency),
          walletsLine(alert.walletsTotal, currency),
        ]
          .filter(Boolean)
          .join('\n');
      }

      return [
        `📊 <b>День в цифрах</b>`,
        `Потрачено сегодня: ${money(spentToday, currency)}.`,
        ...spendLines(alert),
        alert.budget === null
          ? `Лимиты не заданы — сравнивать не с чем.`
          : alert.overLimit
            ? `Лимиты: вышли за них по отдельным категориям.`
            : `Лимиты: уложились.`,
        restLine(alert.remaining, currency),
        walletsLine(alert.walletsTotal, currency),
      ]
        .filter(Boolean)
        .join('\n');
    }
  }
}
