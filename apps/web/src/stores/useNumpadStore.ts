import { create } from 'zustand';

/**
 * Встроенная клавиатура-калькулятор для ввода сумм.
 *
 * Зачем свой ввод вместо системной клавиатуры: нативное поле в Telegram Mini App
 * теряло фокус после первой же цифры, и набор суммы превращался в борьбу. Здесь
 * клавиатура своя — экранная, поверх шторки, — и заодно умеет арифметику: разделить
 * счёт на троих, прибавить чаевые и т.п. прямо в поле суммы.
 *
 * Движок калькулятора живёт в сторе, а не в компоненте, чтобы одно и то же
 * состояние читали и панель клавиатуры, и активное поле, и чипы быстрых сумм.
 */

type Op = '+' | '-' | '*' | '/';

export const OP_SYMBOL: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** Куда возвращать результат и как подписать клавиатуру над конкретным полем. */
interface NumpadConfig {
  /** Заголовок панели (например, «Сумма» или «Бюджет на месяц»). */
  title: string;
  /** Строка-совместимая с parseAmount: сюда уходит текущее значение. */
  onChange: (value: string) => void;
}

interface Calc {
  /** Накопленный операнд слева от оператора. null — операции нет. */
  acc: number | null;
  op: Op | null;
  /** Правый операнд как строка: сохраняем ввод «5,» до появления дробной части. */
  operand: string;
}

interface NumpadState {
  open: boolean;
  /** Токен активного поля — поле по нему понимает, открыта ли клавиатура именно для него. */
  fieldId: string | null;
  title: string;
  calc: Calc;
  /** Колбэк активного поля. Вне перерисовок: панель его не читает, только commit. */
  config: NumpadConfig | null;

  openFor: (fieldId: string, config: NumpadConfig & { value: string }) => void;
  close: () => void;
  digit: (d: string) => void;
  decimal: () => void;
  operator: (op: Op) => void;
  equals: () => void;
  backspace: () => void;
  clear: () => void;
  /** Заменить операнд целиком — для чипов быстрых сумм. */
  setOperand: (value: string) => void;
}

const EMPTY: Calc = { acc: null, op: null, operand: '' };
/** Ограничение длины операнда: 12 значащих цифр перекрывают любой разумный бюджет. */
const MAX_LEN = 13;

/** Округление до копеек: 1000/3 = 333,33, а не 333,3333333. */
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Операнд-строку (с запятой) — в число для арифметики. */
function toNumber(operand: string): number {
  return Number(operand.replace(',', '.')) || 0;
}

/** Число — в строку с запятой как разделителем, без хвостовых нулей. */
function toOperand(n: number): string {
  return String(n).replace('.', ',');
}

function apply(a: number, op: Op, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      // Деление на ноль оставляет левый операнд: молча, без NaN и Infinity в поле.
      return b === 0 ? a : a / b;
  }
}

/**
 * Текущее эффективное значение калькулятора — то, что уйдёт в поле.
 *
 * Если набрано «5 + 3», значением считается результат (8): нажимать «=» перед
 * подтверждением не обязательно. Незавершённое «5 +» — это просто 5.
 */
function emit(calc: Calc): string {
  const { acc, op, operand } = calc;
  if (op !== null && acc !== null && operand !== '') {
    return String(roundMoney(apply(acc, op, toNumber(operand))));
  }
  if (operand !== '') return operand; // сохраняем «5,» как есть — parseAmount поймёт
  if (acc !== null) return String(acc);
  return '';
}

/** Выражение для строки над клавишами: «500 × 3». */
export function expressionOf(calc: Calc): string {
  const parts: string[] = [];
  if (calc.acc !== null) parts.push(toOperand(calc.acc));
  if (calc.op !== null) parts.push(OP_SYMBOL[calc.op]);
  if (calc.operand !== '') parts.push(calc.operand);
  return parts.join(' ') || '0';
}

export const useNumpadStore = create<NumpadState>((set, get) => {
  /** Применить мутацию калькулятора и тут же отдать новое значение в поле. */
  const commit = (calc: Calc) => {
    set({ calc });
    get().config?.onChange(emit(calc));
  };

  return {
    open: false,
    fieldId: null,
    title: 'Сумма',
    calc: EMPTY,
    config: null,

    openFor(fieldId, config) {
      // Инициализируем операнд текущим значением поля: правка — это продолжение
      // ввода, а не старт с нуля.
      const operand = config.value ? config.value.replace('.', ',') : '';
      set({
        open: true,
        fieldId,
        title: config.title,
        calc: { acc: null, op: null, operand },
        config: { title: config.title, onChange: config.onChange },
      });
    },

    close() {
      set({ open: false, fieldId: null, calc: EMPTY, config: null });
    },

    digit(d) {
      const { operand } = get().calc;
      if (operand.replace(/[,.]/g, '').length >= MAX_LEN) return;
      // Ведущий ноль заменяем первой значащей цифрой: «0» + «5» = «5», не «05».
      const next = operand === '0' && d !== '0' ? d : operand === '0' ? '0' : operand + d;
      commit({ ...get().calc, operand: next });
    },

    decimal() {
      const { operand } = get().calc;
      if (operand.includes(',')) return;
      commit({ ...get().calc, operand: operand === '' ? '0,' : operand + ',' });
    },

    operator(op) {
      const { acc, op: prevOp, operand } = get().calc;
      if (operand === '' && acc === null) return; // нельзя начинать с оператора
      if (operand === '') {
        // Сменить оператор, не вводя второй операнд: «5 +» → «5 ×».
        commit({ acc, op, operand: '' });
        return;
      }
      const left = acc === null ? toNumber(operand) : roundMoney(apply(acc, prevOp!, toNumber(operand)));
      commit({ acc: left, op, operand: '' });
    },

    equals() {
      const { acc, op, operand } = get().calc;
      if (op === null || acc === null || operand === '') return;
      const result = roundMoney(apply(acc, op, toNumber(operand)));
      commit({ acc: null, op: null, operand: toOperand(result) });
    },

    backspace() {
      const { acc, op, operand } = get().calc;
      if (operand !== '') {
        commit({ acc, op, operand: operand.slice(0, -1) });
      } else if (op !== null) {
        commit({ acc, op: null, operand: '' });
      } else if (acc !== null) {
        // Возвращаем накопленное в операнд, чтобы его можно было дочистить.
        commit({ acc: null, op: null, operand: toOperand(acc) });
      }
    },

    clear() {
      commit(EMPTY);
    },

    setOperand(value) {
      commit({ acc: null, op: null, operand: value.replace('.', ',') });
    },
  };
});
