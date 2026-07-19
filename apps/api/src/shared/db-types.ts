import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Минимальный контракт исполнителя запросов: подходит и пулу, и клиенту внутри
 * транзакции. Репозитории принимают его, чтобы один и тот же метод работал
 * как автономно, так и внутри атомарной DnD-операции.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
