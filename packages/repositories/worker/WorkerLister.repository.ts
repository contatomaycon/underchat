import * as schema from '@core/models';
import {
  worker,
  workerStatus,
  workerType,
  server,
  account,
  workerRuntime,
  whatsappSessionLease,
  workerWhatsappOfficialConnection,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  isNull,
  SQL,
  asc,
  desc,
  SQLWrapper,
  ilike,
  count,
  or,
  sql,
  notInArray,
} from 'drizzle-orm';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ESortByWorker } from '@core/common/enums/ESortByWorker';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusObservedAt,
  normalizeWhatsappConnectionStatusSourceId,
} from '@core/common/functions/whatsappConnectionStatus';
import { projectWorkerRecreatePhaseProjection } from '@core/common/functions/workerRecreatePhase';
import { liveWhatsappSessionLeaseJoinCondition } from './workerEffectiveOnline.sql';
import { buildMetaWhatsappTemplateManagerUrl } from '@core/common/functions/metaWhatsappTemplateManagerUrl';

const hiddenLifecycleDeletionStatuses = [
  EWorkerStatus.deleting,
  EWorkerStatus.delete,
];

@injectable()
export class WorkerListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly normalizeServer = (
    input?: { id: string | null; name: string | null } | null
  ): ListWorkerResponse['server'] => {
    if (!input?.id) {
      return null;
    }

    return {
      id: input.id,
      name: input.name,
    };
  };

  private readonly setOrders = (query: ListWorkerRequest): SQL[] => {
    if (!query.sort_by?.length) {
      return [asc(worker.created_at), desc(worker.worker_id)];
    }

    const mapping: Record<ESortByWorker, SQLWrapper> = {
      [ESortByWorker.name]: worker.name,
      [ESortByWorker.number]: worker.number,
      [ESortByWorker.server]: server.name,
      [ESortByWorker.status]: workerStatus.status,
      [ESortByWorker.type]: workerType.type,
      [ESortByWorker.account]: account.name,
      [ESortByWorker.created_at]: worker.created_at,
    };

    return query.sort_by.map(({ key, order }) => {
      const column = mapping[key as ESortByWorker];

      return order === ESortOrder.asc ? asc(column) : desc(column);
    });
  };

  private readonly setFilters = (query: ListWorkerRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.number || query.server || query.account) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(worker.name, `%${query.name}%`) : undefined,
        query.number ? ilike(worker.number, `%${query.number}%`) : undefined,
        query.server ? ilike(server.name, `%${query.server}%`) : undefined,
        query.account ? ilike(account.name, `%${query.account}%`) : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.status) {
      filters.push(eq(worker.worker_status_id, query.status));
    }

    if (query.type) {
      filters.push(eq(workerType.worker_type_id, query.type));
    }

    return filters;
  };

  listWorker = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListWorkerRequest
  ): Promise<ListWorkerResponse[]> => {
    const orders = this.setOrders(query);
    const filters = this.setFilters(query);

    const queryBuilder = this.dbRw
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
        recreate_available_at: worker.recreate_available_at,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        worker_status_observed_at: sql<string>`${worker.updated_at}::text`,
        native_connection_status: workerRuntime.native_connection_public_status,
        native_connection_status_source_id:
          workerRuntime.native_connection_status_source_id,
        native_connection_status_order:
          workerRuntime.native_connection_status_outbox_id,
        native_connection_online_acknowledged: sql<boolean>`(
          COALESCE(
            ${workerRuntime.native_connection_online_acknowledged}, false
          )
          AND ${workerRuntime.session_storage} = ${worker.session_storage}
          AND (
            ${workerRuntime.session_storage} <> 'postgres'
            OR ${whatsappSessionLease.session_id} IS NOT NULL
          )
        )`,
        runtime_generation: workerRuntime.runtime_generation,
        connection_disconnected_at: workerRuntime.connection_disconnected_at,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
        worker_container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
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
        connection_status_observed_at: sql<string | null>`
          ${workerRuntime.native_connection_public_status} ->> 'changedAt'
        `,
        official_business_id: workerWhatsappOfficialConnection.business_id,
        official_waba_id: workerWhatsappOfficialConnection.waba_id,
        provider_handoff_recovery: sql<
          ListWorkerResponse['provider_handoff_recovery']
        >`(
          COALESCE(
            (
              SELECT jsonb_build_object(
                'handoff_id', handoff.handoff_id::text,
                'lifecycle_operation_id', handoff.lifecycle_operation_id::text,
                'source_provider', handoff.source_provider,
                'target_provider', handoff.target_provider
              )
              FROM public.whatsapp_session_handoff AS handoff
              LEFT JOIN public.whatsapp_session_handoff_resolution AS resolution
                ON resolution.session_id = handoff.session_id
               AND resolution.handoff_id = handoff.handoff_id
              WHERE handoff.session_id = ${worker.worker_id}
                AND handoff.state = 'failed'
                AND handoff.lifecycle_operation_id IS NOT NULL
                AND (
                  resolution.session_id IS NULL
                  OR resolution.state <> 'completed'
                )
              ORDER BY handoff.updated_at DESC, handoff.handoff_id DESC
              LIMIT 1
            ),
            (
              -- Discard intentionally deletes whatsapp_session and cascades
              -- its handoff row. The worker-owned resolution survives that
              -- reset so a reload/new tab can resume the same decision.
              SELECT jsonb_build_object(
                'handoff_id', resolution.handoff_id::text,
                'lifecycle_operation_id',
                  resolution.handoff_lifecycle_operation_id::text,
                'source_provider', resolution.source_provider,
                'target_provider', resolution.target_provider
              )
              FROM public.whatsapp_session_handoff_resolution AS resolution
              WHERE resolution.session_id = ${worker.worker_id}
                AND resolution.state <> 'completed'
              ORDER BY resolution.updated_at DESC, resolution.handoff_id DESC
              LIMIT 1
            )
          )
        )`,
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
      .leftJoin(whatsappSessionLease, liveWhatsappSessionLeaseJoinCondition())
      .leftJoin(
        workerWhatsappOfficialConnection,
        and(
          eq(workerWhatsappOfficialConnection.worker_id, worker.worker_id),
          isNull(workerWhatsappOfficialConnection.deleted_at)
        )
      )
      .where(
        and(
          eq(account.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, hiddenLifecycleDeletionStatuses),
          ...filters
        )
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListWorkerResponse[];
    }

    return result.map((item) => {
      const provider =
        item.type.id === EWorkerType.baileys
          ? 'baileys'
          : item.type.id === EWorkerType.wwebjs
            ? 'wwebjs'
            : item.type.id === EWorkerType.whatsmeow
              ? 'whatsmeow'
              : undefined;
      const connectionStatus = provider
        ? normalizeWhatsappConnectionStatus(
            item.native_connection_status,
            provider
          )
        : undefined;
      const connectionStatusSourceId = connectionStatus
        ? normalizeWhatsappConnectionStatusSourceId(
            item.native_connection_status_source_id
          )
        : undefined;
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
      const recreateCompletedAt = normalizeWhatsappConnectionStatusObservedAt(
        item.recreate_completed_at
      );
      const hasRecreateCompletion = Boolean(
        item.recreate_completed_operation_id &&
        item.recreate_completed_runtime_generation &&
        recreateCompletedAt
      );
      const officialTemplateManagerUrl = buildMetaWhatsappTemplateManagerUrl({
        wabaId: item.official_waba_id,
        businessId: item.official_business_id,
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
        recreate_available_at: item.recreate_available_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
        ...(officialTemplateManagerUrl
          ? {
              official_template_manager_url: officialTemplateManagerUrl,
            }
          : {}),
        worker_status_observed_at: normalizeWhatsappConnectionStatusObservedAt(
          item.worker_status_observed_at
        ),
        connection_status: connectionStatusSourceId ? connectionStatus : null,
        connection_status_source_id: connectionStatusSourceId ?? null,
        connection_status_order:
          connectionStatusSourceId && item.native_connection_status_order
            ? String(item.native_connection_status_order)
            : null,
        connection_online_acknowledged:
          Boolean(connectionStatusSourceId) &&
          item.native_connection_online_acknowledged,
        connection_status_observed_at:
          normalizeWhatsappConnectionStatusObservedAt(
            item.connection_status_observed_at
          ),
        connection_disconnected_at: normalizeWhatsappConnectionStatusObservedAt(
          item.connection_disconnected_at
        ),
        ...(item.runtime_generation
          ? { runtime_generation: item.runtime_generation }
          : {}),
        ...(item.lifecycle_operation_id
          ? { lifecycle_operation_id: item.lifecycle_operation_id }
          : {}),
        ...(recreatePhase
          ? {
              recreate_phase: recreatePhase.phase,
              recreate_runtime_retired: recreatePhase.runtimeRetired,
              ...(recreatePhase.observedAt
                ? {
                    recreate_phase_observed_at: recreatePhase.observedAt,
                  }
                : {}),
            }
          : {}),
        ...(hasRecreateCompletion
          ? {
              recreate_completed_operation_id:
                item.recreate_completed_operation_id as string,
              recreate_completed_runtime_generation:
                item.recreate_completed_runtime_generation as number,
              recreate_completed_at: recreateCompletedAt as string,
            }
          : {}),
        provider_handoff_recovery: item.provider_handoff_recovery ?? null,
      };
    });
  };

  listWorkerTotal = async (
    accountId: string,
    query: ListWorkerRequest
  ): Promise<number> => {
    const filters = this.setFilters(query);

    const result = await this.dbRw
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
      .where(
        and(
          eq(account.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, hiddenLifecycleDeletionStatuses),
          ...filters
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
