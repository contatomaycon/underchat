import { createHash } from 'node:crypto';
import {
  Pool,
  type PoolClient,
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import { EWorkerType } from '@core/common/enums/EWorkerType';

let pool: Pool | undefined;
let scopedPool: Pool | undefined;

const WORKER_PREPARED_STATEMENT_PREFIX = 'underchat_worker_';

type WorkerPostgresQuery = {
  name?: unknown;
  queryMode?: unknown;
  submit?: unknown;
  text?: unknown;
  values?: unknown;
};

function preparedStatementName(sql: string): string {
  return `${WORKER_PREPARED_STATEMENT_PREFIX}${createHash('sha256')
    .update(sql)
    .digest('hex')
    .slice(0, 40)}`;
}

function hasQueryValues(query: WorkerPostgresQuery, args: unknown[]): boolean {
  const values = Array.isArray(query.values) ? query.values : args[1];
  return Array.isArray(values) && values.length > 0;
}

function pgBouncerSafeQueryArguments(args: unknown[]): unknown[] {
  const query = args[0];
  if (typeof query === 'string') {
    if (!Array.isArray(args[1]) || args[1].length === 0) return args;
    return [
      { name: preparedStatementName(query), text: query },
      ...args.slice(1),
    ];
  }
  if (query === null || typeof query !== 'object') return args;

  const config = query as WorkerPostgresQuery;
  if (
    typeof config.text !== 'string' ||
    typeof config.submit === 'function' ||
    config.queryMode === 'simple' ||
    (typeof config.name === 'string' && config.name.length > 0) ||
    !hasQueryValues(config, args)
  ) {
    return args;
  }

  return [
    { ...config, name: preparedStatementName(config.text) },
    ...args.slice(1),
  ];
}

/**
 * PgBouncer transaction pooling can move an unpinned client to another
 * backend. Give every parameterized node-postgres query a stable protocol
 * name so PgBouncer can track and re-prepare it on the selected backend.
 * The pooler must keep max_prepared_statements enabled before this code is
 * rolled out (declared in underchat-argocd/database/pg-stack/pg-stack.yaml).
 */
export function installWorkerPostgresQueryProtocol(client: PoolClient): void {
  const originalQuery = client.query;
  const compatibleQuery = (...args: unknown[]): unknown =>
    Reflect.apply(
      originalQuery as unknown as (...queryArgs: unknown[]) => unknown,
      client,
      pgBouncerSafeQueryArguments(args)
    );
  client.query = compatibleQuery as typeof client.query;
}

interface WorkerOperationIdentity {
  accountId: string;
  capability: string;
  containerId: string;
  generation: number;
  provider: 'baileys' | 'whatsmeow' | 'wwebjs';
  workerId: string;
  writerEpoch: string;
}

function runtimeProvider(
  workerTypeId: string
): WorkerOperationIdentity['provider'] {
  if (workerTypeId === EWorkerType.baileys) return 'baileys';
  if (workerTypeId === EWorkerType.wwebjs) return 'wwebjs';
  if (workerTypeId === EWorkerType.whatsmeow) return 'whatsmeow';
  throw new Error('worker_runtime_provider_invalid');
}

function workerOperationIdentity(): WorkerOperationIdentity {
  const generation = Number(process.env.RUNTIME_GENERATION);
  const capability = process.env.WORKER_RUNTIME_CAPABILITY?.trim() ?? '';
  const writerEpoch = process.env.WORKER_WRITER_EPOCH?.trim() ?? '';
  const containerId = process.env.HOSTNAME?.trim() ?? '';
  const workerId = process.env.WORKER_ID?.trim() ?? '';
  const accountId = process.env.ACCOUNT_ID?.trim() ?? '';
  const workerTypeId = process.env.WORKER_TYPE_ID?.trim() ?? '';
  if (
    !Number.isSafeInteger(generation) ||
    generation <= 0 ||
    capability.length < 32 ||
    capability.length > 512 ||
    !/^[0-9a-f-]{36}$/iu.test(writerEpoch) ||
    !/^[0-9a-f]{12,64}$/iu.test(containerId) ||
    !/^[0-9a-f-]{36}$/iu.test(workerId) ||
    !/^[0-9a-f-]{36}$/iu.test(accountId)
  ) {
    throw new Error('worker_runtime_database_identity_invalid');
  }
  return {
    accountId,
    capability,
    containerId,
    generation,
    provider: runtimeProvider(workerTypeId),
    workerId,
    writerEpoch,
  };
}

async function installWorkerOperationScope(client: PoolClient): Promise<void> {
  const identity = workerOperationIdentity();
  const result = await client.query<{ scoped: boolean }>(
    `SELECT begin_whatsapp_worker_operation(
       $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7
     ) AS scoped`,
    [
      identity.workerId,
      identity.accountId,
      identity.provider,
      identity.generation,
      identity.writerEpoch,
      identity.capability,
      identity.containerId,
    ]
  );
  if (result.rows[0]?.scoped !== true) {
    throw new Error('worker_runtime_database_scope_rejected');
  }
}

function queryText(query: unknown): string {
  if (typeof query === 'string') return query;
  if (
    query !== null &&
    typeof query === 'object' &&
    'text' in query &&
    typeof query.text === 'string'
  ) {
    return query.text;
  }
  return '';
}

function scopedClient(rawClient: PoolClient): PoolClient {
  let transactionActive = false;
  let scopeInstalled = false;
  return new Proxy(rawClient, {
    get(target, property) {
      if (property === 'query') {
        return async (...args: unknown[]): Promise<QueryResult> => {
          const sql = queryText(args[0]).trim().toLowerCase();
          const invoke = (): Promise<QueryResult> =>
            Reflect.apply(target.query, target, args) as Promise<QueryResult>;
          if (/^begin(?:\s|$)/u.test(sql)) {
            const result = await invoke();
            transactionActive = true;
            try {
              await installWorkerOperationScope(target);
              scopeInstalled = true;
              return result;
            } catch (error) {
              transactionActive = false;
              scopeInstalled = false;
              await target.query('ROLLBACK').catch(() => undefined);
              throw error;
            }
          }
          if (/^(?:commit|rollback)(?:\s|$)/u.test(sql)) {
            try {
              return await invoke();
            } finally {
              transactionActive = false;
              scopeInstalled = false;
            }
          }
          if (transactionActive) {
            if (!scopeInstalled) {
              await installWorkerOperationScope(target);
              scopeInstalled = true;
            }
            return invoke();
          }

          await target.query('BEGIN');
          transactionActive = true;
          try {
            await installWorkerOperationScope(target);
            scopeInstalled = true;
            const result = await invoke();
            await target.query('COMMIT');
            transactionActive = false;
            scopeInstalled = false;
            return result;
          } catch (error) {
            transactionActive = false;
            scopeInstalled = false;
            await target.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        };
      }
      if (property === 'release') {
        return (): void => {
          if (transactionActive) {
            // Never return a backend carrying an unfinished transaction/GUC
            // scope to PgBouncer or another caller.
            target.release(true);
            transactionActive = false;
            scopeInstalled = false;
            return;
          }
          target.release();
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

class WorkerScopedPostgresPool {
  constructor(private readonly rawPool: Pool) {}

  async connect(): Promise<PoolClient> {
    return scopedClient(await this.rawPool.connect());
  }

  async query<
    R extends QueryResultRow = QueryResultRow,
    I extends readonly unknown[] = readonly unknown[],
  >(query: string | QueryConfig<I>, values?: I): Promise<QueryResult<R>> {
    const client = await this.rawPool.connect();
    try {
      await client.query('BEGIN');
      await installWorkerOperationScope(client);
      const result = (await client.query(
        query as never,
        values as never
      )) as unknown as QueryResult<R>;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function getWorkerPostgresPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.WORKER_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('WORKER_DATABASE_URL is required');
  }

  pool = new Pool({
    connectionString,
    min: 0,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    application_name: 'underchat-whatsapp-worker',
    options: '-c statement_timeout=15000 -c lock_timeout=5000',
  });
  pool.on('connect', installWorkerPostgresQueryProtocol);
  // A background pool error must never include connection details in logs.
  pool.on('error', () => undefined);
  return pool;
}

/**
 * Pool facade for worker-owned Drizzle repositories. Every standalone query
 * and explicit Drizzle transaction receives a database-signed, SET LOCAL
 * worker scope before tenant tables are touched.
 */
export function getWorkerScopedPostgresPool(): Pool {
  if (scopedPool) return scopedPool;
  scopedPool = new WorkerScopedPostgresPool(
    getWorkerPostgresPool()
  ) as unknown as Pool;
  return scopedPool;
}

export async function closeWorkerPostgresPool(): Promise<void> {
  const current = pool;
  pool = undefined;
  scopedPool = undefined;
  await current?.end();
}
