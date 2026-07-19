/** Склейка классов без зависимостей: falsy-значения отбрасываются. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
