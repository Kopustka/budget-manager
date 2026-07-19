import { getInitData } from '../lib/telegram.js';

/** HTTP-клиент к API. Единственное место, где знают про заголовок авторизации. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Бизнес-конфликт (недостаточно средств) — показываем пользователю как есть. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** Запрет матрицы — повод для пружины и haptic error. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `tma ${getInitData()}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await res.json().catch(() => null)) as
    | { error?: { code: string; message: string } }
    | null;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Ошибка запроса (${res.status})`,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
