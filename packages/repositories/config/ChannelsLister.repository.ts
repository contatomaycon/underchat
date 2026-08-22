import * as schema from '@core/models';
import {
  worker,
  workerStatus,
  workerType,
  server,
  account,
  workerRuntime,
  whatsappSessionStorageMigration,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  SQLWrapper,
  count,
  SQL,
  or,
  inArray,
  sql,
} from 'drizzle-orm';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { IConfigChannelsRecreateAllFilters } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { IConfigChannelRecreateTarget } from '@core/common/interfaces/IConfigChannelRecreateTarget';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { projectWorkerRecreatePhaseProjection } from '@core/common/functions/workerRecreatePhase';
import { toSessionStorageMigrationSummary } from './SessionStorageMigration.repository';

@injectable()
export class ChannelsListerRepository {
  private readonly dbRw: NodePgDatabase<typeof schema>;

  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') dbRw?: NodePgDatabase<typeof schema>
  ) {
    this.dbRw = dbRw ?? dbRo;
  }

  private readonly normalizeServer = (
    input?: { id: string | null; name: string | null } | null
  ): ListChannelsResponse['server'] => {
    if (!input?.id) {
      return null;
    }

    return {
      id: input.id,
      name: input.name,
    };
  };

  private readonly buildNameOrNumberFilter = (
    name?: string | null,
    number?: string | null
  ): SQLWrapper | undefined => {
    const filters = [
      name ? ilike(worker.name, `%${name}%`) : undefined,
      number ? ilike(worker.number, `%${number}%`) : undefined,
    ].filter((filter): filter is SQL => Boolean(filter));

    if (!filters.length) {
      return undefined;
    }

    return or(...filters);
  };

  private readonly setOrders = (query: ListChannelsRequest): SQL[] => {
    if (!query.sort_by?.length) {
      return [];
    }

    const mapping: Record<string, SQLWrapper> = {
      name: worker.name,
      number: worker.number,
      status: workerStatus.status,
      type: workerType.type,
      account: account.name,
      server: server.name,
      connection_date: worker.connection_date,
      created_at: worker.created_at,
    };

    const orders: SQL[] = [];

    for (const sort of query.sort_by) {
      const column = mapping[sort.key];
      if (!column) continue;

      const order = sort.order === 'asc' ? asc(column) : desc(column);
      orders.push(order);
    }

    return orders;
  };

  private readonly setFilters = (query: ListChannelsRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.status) {
      filters.push(
        query.status === EWorkerStatus.connecting
          ? this.visibleConnectingFilter()
          : eq(worker.worker_status_id, query.status)
      );
    }

    if (query.type) {
      filters.push(eq(workerType.worker_type_id, query.type));
    }

    if (query.session_storage) {
      filters.push(eq(worker.session_storage, query.session_storage));
    }

    if (query.account) {
      filters.push(eq(account.account_id, query.account));
    }

    const searchFilter = this.buildNameOrNumberFilter(query.name, query.number);
    if (searchFilter) {
      filters.push(searchFilter);
    }

    return filters;
  };

  /**
   * The banner presents an authenticated recreate as "connecting" after the
   * exact replacement runtime has bootstrapped, while the lifecycle status
   * intentionally remains `recreating`. The Config filter must include that
   * same fenced presentation as well as the durable QR-pairing status.
   */
  private readonly visibleConnectingFilter = (): SQL =>
    or(
      eq(worker.worker_status_id, EWorkerStatus.connecting),
      and(
        eq(worker.worker_status_id, EWorkerStatus.recreating),
        isNotNull(worker.number),
        sql`btrim(${worker.number}) <> ''`,
        eq(
          workerRuntime.recreate_bootstrap_operation_id,
          worker.lifecycle_operation_id
        ),
        eq(
          workerRuntime.recreate_bootstrap_runtime_generation,
          workerRuntime.runtime_generation
        ),
        sql`lower(trim(${workerRuntime.recreate_bootstrap_container_id})) = lower(trim(${workerRuntime.container_id}))`,
        isNotNull(workerRuntime.recreate_bootstrap_started_at),
        isNull(workerRuntime.recreate_retired_operation_id)
      )
    ) as SQL;

  private readonly listDatabase = (query: ListChannelsRequest) =>
    query.status ? this.dbRw : this.dbRo;

  listChannels = async (
    perPage: number,
    currentPage: number,
    query: ListChannelsRequest
  ): Promise<ListChannelsResponse[]> => {
    const orders = this.setOrders(query);
    const filters = this.setFilters(query);
    const database = this.listDatabase(query);

    const queryBuilder = database
      .select({
        id: worker.worker_id,
        name: worker.name,
        session_storage: worker.session_storage,
        number: worker.number,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
        type: {
          id: workerType.worker_type_id,
          name: workerType.type,
        },
        server: {
          id: server.server_id,
          name: server.name,
        },
        account: {
          id: account.account_id,
          name: account.name,
        },
        connection_date: worker.connection_date,
        last_connection_check_at: worker.last_connection_check_at,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        worker_container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_generation: workerRuntime.runtime_generation,
        recreate_bootstrap_operation_id:
          workerRuntime.recreate_bootstrap_operation_id,
        recreate_bootstrap_runtime_generation:
          workerRuntime.recreate_bootstrap_runtime_generation,
        recreate_bootstrap_container_id:
          workerRuntime.recreate_bootstrap_container_id,
        recreate_bootstrap_started_at:
          workerRuntime.recreate_bootstrap_started_at,
        recreate_retired_operation_id:
          workerRuntime.recreate_retired_operation_id,
        recreate_retired_runtime_generation:
          workerRuntime.recreate_retired_runtime_generation,
        recreate_retired_container_id:
          workerRuntime.recreate_retired_container_id,
        recreate_retired_at: workerRuntime.recreate_retired_at,
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .leftJoin(server, eq(server.server_id, worker.server_id))
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(
        and(isNull(worker.deleted_at), isNull(account.deleted_at), ...filters)
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListChannelsResponse[];
    }

    const migrationRows = await database
      .select()
      .from(whatsappSessionStorageMigration)
      .where(
        inArray(
          whatsappSessionStorageMigration.worker_id,
          result.map((item) => item.id)
        )
      )
      .orderBy(desc(whatsappSessionStorageMigration.created_at))
      .execute();
    const latestMigrationByWorker = new Map<
      string,
      (typeof migrationRows)[number]
    >();
    for (const migration of migrationRows) {
      if (!latestMigrationByWorker.has(migration.worker_id)) {
        latestMigrationByWorker.set(migration.worker_id, migration);
      }
    }

    return result.map((item) => {
      const latestMigration = latestMigrationByWorker.get(item.id);
      const recreatePhase = projectWorkerRecreatePhaseProjection({
        workerStatusId: item.status?.id,
        lifecycleOperationId: item.lifecycle_operation_id,
        workerContainerId: item.worker_container_id,
        runtimeContainerId: item.runtime_container_id,
        runtimeGeneration: item.runtime_generation,
        bootstrapOperationId: item.recreate_bootstrap_operation_id,
        bootstrapRuntimeGeneration: item.recreate_bootstrap_runtime_generation,
        bootstrapContainerId: item.recreate_bootstrap_container_id,
        bootstrapStartedAt: item.recreate_bootstrap_started_at,
        retiredOperationId: item.recreate_retired_operation_id,
        retiredRuntimeGeneration: item.recreate_retired_runtime_generation,
        retiredContainerId: item.recreate_retired_container_id,
        retiredAt: item.recreate_retired_at,
      });

      return {
        id: item.id,
        name: item.name,
        session_storage: item.session_storage,
        number: item.number,
        status: item.status,
        type: item.type,
        server: this.normalizeServer(item.server),
        account: item.account,
        connection_date: item.connection_date,
        last_connection_check_at: item.last_connection_check_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
        ...(recreatePhase ? { recreate_phase: recreatePhase.phase } : {}),
        session_storage_migration: latestMigration
          ? toSessionStorageMigrationSummary(latestMigration)
          : null,
      };
    });
  };

  listChannelsTotal = async (query: ListChannelsRequest): Promise<number> => {
    const filters = this.setFilters(query);
    const database = this.listDatabase(query);

    const result = await database
      .select({
        count: count(),
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .leftJoin(server, eq(server.server_id, worker.server_id))
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(
        and(isNull(worker.deleted_at), isNull(account.deleted_at), ...filters)
      )
      .execute();

    return result[0]?.count ?? 0;
  };

  listAllNonDeletedChannelIds = async (
    filtersInput: IConfigChannelsRecreateAllFilters
  ): Promise<string[]> => {
    const targets =
      await this.listAllNonDeletedChannelRecreateTargets(filtersInput);

    return targets.map((item) => item.worker_id);
  };

  listAllNonDeletedChannelRecreateTargets = async (
    filtersInput: IConfigChannelsRecreateAllFilters
  ): Promise<IConfigChannelRecreateTarget[]> => {
    const filters: SQLWrapper[] = [
      isNull(worker.deleted_at),
      isNull(account.deleted_at),
      isNotNull(worker.server_id),
      ne(workerType.worker_type_id, EWorkerType.whatsapp),
    ];

    if (filtersInput.status) {
      filters.push(eq(workerStatus.worker_status_id, filtersInput.status));
    }

    if (filtersInput.type) {
      filters.push(eq(workerType.worker_type_id, filtersInput.type));
    }

    if (filtersInput.session_storage) {
      filters.push(eq(worker.session_storage, filtersInput.session_storage));
    }

    if (filtersInput.account) {
      filters.push(eq(account.account_id, filtersInput.account));
    }

    const searchFilter = this.buildNameOrNumberFilter(
      filtersInput.name,
      filtersInput.number
    );
    if (searchFilter) {
      filters.push(searchFilter);
    }

    const result = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        worker_account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        worker_container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_generation: workerRuntime.runtime_generation,
      })
      .from(worker)
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(and(...filters))
      .execute();

    return result.map((item) => ({
      worker_id: item.worker_id,
      worker_account_id: item.worker_account_id,
      server_id: item.server_id as string,
      worker_type_id: item.worker_type_id,
      worker_status_id: item.worker_status_id,
      worker_container_id: item.worker_container_id,
      runtime_container_id: item.runtime_container_id,
      runtime_generation: item.runtime_generation,
    }));
  };
}
