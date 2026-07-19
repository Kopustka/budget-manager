/** Типизированные ошибки приложения с HTTP-статусами. */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Не авторизован') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Операция запрещена') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Не найдено') {
    super(404, message, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Некорректные данные') {
    super(422, message, 'VALIDATION');
  }
}

/** Овердрафт/недостаточно средств — бизнес-конфликт. */
export class ConflictError extends AppError {
  constructor(message = 'Конфликт операции') {
    super(409, message, 'CONFLICT');
  }
}
