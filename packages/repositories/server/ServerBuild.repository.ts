import * as schema from '@core/models';
import {
  serverBuildJob,
  serverBuildJobItem,
  serverBuildVersion,
} from '@core/models';
import { EServerBuildJobItemStatus } from '@core/common/enums/EServerBuildJobItemStatus';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { buildEnvironment } from '@core/config/environments';
import { currentTime } from '@core/common/functions/currentTime';
import { ICancelServerBuildResult } from '@core/common/interfaces/ICancelServerBuildResult';
import { ICreateServerBuildJobResult } from '@core/common/interfaces/ICreateServerBuildJobResult';
import { IMarkServerBuildItemSuccessInput } from '@core/common/interfaces/IMarkServerBuildItemSuccessInput';
import { IDeleteServerBuildResult } from '@core/common/interfaces/IDeleteServerBuildResult';
import { IHarborBuildVersionByType } from '@core/common/interfaces/IHarborBuildVersionByType';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { IServerBuildJobWithItems } from '@core/common/interfaces/IServerBuildJobWithItems';
import { ServerBuildDefaultResponse } from '@core/schema/server/setServerBuildDefault/response.schema';
import {
  ServerBuildJob,
  ServerBuildJobItem,
  ServerBuildVersion,
  ServerBuildViewResponse,
} from '@core/schema/server/viewServerBuild/response.schema';
import { and, desc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import moment from 'moment-timezone';

class ActiveBuildJobConflictError extends Error {
  constructor() {
    super('Active build job already exists');
  }
}

type ServerBuildJobRow = typeof serverBuildJob.$inferSelect;
type ServerBuildJobItemRow = typeof serverBuildJobItem.$inferSelect;
type ServerBuildVersionRow = typeof serverBuildVersion.$inferSelect;

@injectable()
export class ServerBuildRepository {
  private readonly activeJobStatuses: EServerBuildJobStatus[] = [
    EServerBuildJobStatus.queued,
    EServerBuildJobStatus.running,
    EServerBuildJobStatus.cancel_requested,
  ];
  private readonly terminalJobStatuses: EServerBuildJobStatus[] = [
    EServerBuildJobStatus.completed,
    EServerBuildJobStatus.failed,
    EServerBuildJobStatus.canceled,
  ];

  private readonly buildTypes: EServerBuildType[] = [
    EServerBuildType.baileys,
    EServerBuildType.wwebjs,
    EServerBuildType.whatsmeow,
    EServerBuildType.balance_api,
  ];

  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private isUniqueConflictError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('server_build_job_active_unique_idx') &&
      message.includes('duplicate')
    );
  }

  private ensureBuildTypeOrder<T extends { build_type: EServerBuildType }>(
    items: T[]
  ): T[] {
    const orderMap = new Map(
      this.buildTypes.map((buildType, index) => [buildType, index])
    );

    return [...items].sort((a, b) => {
      const orderA = orderMap.get(a.build_type) ?? 999;
      const orderB = orderMap.get(b.build_type) ?? 999;
      return orderA - orderB;
    });
  }

  private mapJobItem(item: ServerBuildJobItemRow): ServerBuildJobItem {
    return {
      server_build_job_item_id: item.server_build_job_item_id,
      server_build_job_id: item.server_build_job_id,
      build_type: item.build_type,
      status: item.status,
      image_reference: item.image_reference ?? null,
      error_message: item.error_message ?? null,
      created_at: item.created_at ?? '',
      updated_at: item.updated_at ?? '',
      started_at: item.started_at ?? null,
      finished_at: item.finished_at ?? null,
    };
  }

  private mapVersion(version: ServerBuildVersionRow): ServerBuildVersion {
    return {
      server_build_version_id: version.server_build_version_id,
      build_type: version.build_type,
      version: version.version,
      harbor_registry: version.harbor_registry,
      harbor_repository: version.harbor_repository,
      image_reference: version.image_reference,
      is_default: version.is_default,
      created_at: version.created_at ?? '',
      updated_at: version.updated_at ?? '',
    };
  }

  private mapJob(
    job: ServerBuildJobRow,
    items: ServerBuildJobItem[]
  ): ServerBuildJob {
    return {
      server_build_job_id: job.server_build_job_id,
      requested_by: job.requested_by ?? null,
      version: job.version,
      status: job.status,
      error_message: job.error_message ?? null,
      created_at: job.created_at ?? '',
      updated_at: job.updated_at ?? '',
      started_at: job.started_at ?? null,
      finished_at: job.finished_at ?? null,
      items,
    };
  }

  private async keepOnlyLastFiveVersions(
    tx: any,
    buildType: EServerBuildType
  ): Promise<void> {
    const toDelete = await tx
      .select({
        server_build_version_id: serverBuildVersion.server_build_version_id,
      })
      .from(serverBuildVersion)
      .where(eq(serverBuildVersion.build_type, buildType))
      .orderBy(desc(serverBuildVersion.created_at))
      .offset(5)
      .execute();

    if (toDelete.length === 0) {
      return;
    }

    await tx
      .delete(serverBuildVersion)
      .where(
        inArray(
          serverBuildVersion.server_build_version_id,
          toDelete.map(
            (item: { server_build_version_id: string }) =>
              item.server_build_version_id
          )
        )
      )
      .execute();
  }

  private async ensureDefaultVersionWhenMissing(
    tx: any,
    buildType: EServerBuildType,
    version: string,
    now: string
  ): Promise<void> {
    const [currentDefault] = await tx
      .select({
        server_build_version_id: serverBuildVersion.server_build_version_id,
      })
      .from(serverBuildVersion)
      .where(
        and(
          eq(serverBuildVersion.build_type, buildType),
          eq(serverBuildVersion.is_default, true)
        )
      )
      .limit(1)
      .execute();

    if (currentDefault) {
      return;
    }

    await tx
      .update(serverBuildVersion)
      .set({
        is_default: true,
        updated_at: now,
      })
      .where(
        and(
          eq(serverBuildVersion.build_type, buildType),
          eq(serverBuildVersion.version, version)
        )
      )
      .execute();
  }

  listBuilds = async (): Promise<ServerBuildViewResponse> => {
    const [activeJob] = await this.dbRo
      .select()
      .from(serverBuildJob)
      .where(inArray(serverBuildJob.status, this.activeJobStatuses))
      .orderBy(desc(serverBuildJob.created_at))
      .limit(1)
      .execute();

    let activeJobWithItems: ServerBuildJob | null = null;

    if (activeJob) {
      const items = await this.dbRo
        .select()
        .from(serverBuildJobItem)
        .where(
          eq(
            serverBuildJobItem.server_build_job_id,
            activeJob.server_build_job_id
          )
        )
        .orderBy(desc(serverBuildJobItem.created_at))
        .execute();

      activeJobWithItems = this.mapJob(
        activeJob,
        this.ensureBuildTypeOrder(items.map((item) => this.mapJobItem(item)))
      );
    }

    const jobRows = await this.dbRo
      .select()
      .from(serverBuildJob)
      .orderBy(desc(serverBuildJob.created_at))
      .limit(20)
      .execute();

    let jobsWithItems: ServerBuildJob[] = [];
    if (jobRows.length > 0) {
      const jobIds = jobRows.map((job) => job.server_build_job_id);
      const jobItems = await this.dbRo
        .select()
        .from(serverBuildJobItem)
        .where(inArray(serverBuildJobItem.server_build_job_id, jobIds))
        .execute();

      const itemsByJob = new Map<string, ServerBuildJobItem[]>();

      for (const item of jobItems) {
        const mappedItem = this.mapJobItem(item);
        const current = itemsByJob.get(item.server_build_job_id) ?? [];
        current.push(mappedItem);
        itemsByJob.set(item.server_build_job_id, current);
      }

      jobsWithItems = jobRows.map((job) =>
        this.mapJob(
          job,
          this.ensureBuildTypeOrder(
            itemsByJob.get(job.server_build_job_id) ?? []
          )
        )
      );
    }

    const [baileys, wwebjs, whatsmeow, balanceApi] = await Promise.all(
      this.buildTypes.map((buildType) =>
        this.dbRo
          .select()
          .from(serverBuildVersion)
          .where(eq(serverBuildVersion.build_type, buildType))
          .orderBy(desc(serverBuildVersion.created_at))
          .limit(5)
          .execute()
      )
    );

    return {
      active_job: activeJobWithItems,
      jobs: jobsWithItems,
      versions_by_type: {
        [EServerBuildType.baileys]: baileys.map((item) =>
          this.mapVersion(item)
        ),
        [EServerBuildType.wwebjs]: wwebjs.map((item) => this.mapVersion(item)),
        [EServerBuildType.whatsmeow]: whatsmeow.map((item) =>
          this.mapVersion(item)
        ),
        [EServerBuildType.balance_api]: balanceApi.map((item) =>
          this.mapVersion(item)
        ),
      },
    };
  };

  createBuildJob = async (
    requestedBy: string,
    version: string,
    buildTypes: EServerBuildType[],
    requireExistingVersion = false
  ): Promise<ICreateServerBuildJobResult> => {
    const selectedBuildTypes = new Set(buildTypes);
    const hasInvalidBuildType = buildTypes.some(
      (buildType) => !this.buildTypes.includes(buildType)
    );

    if (
      buildTypes.length === 0 ||
      selectedBuildTypes.size !== buildTypes.length ||
      hasInvalidBuildType
    ) {
      return {
        conflict: false,
        invalid_reason: 'invalid_build_types',
      };
    }

    const serverBuildJobId = uuidv7();
    const now = currentTime();

    try {
      const invalidReason = await this.dbRw.transaction(async (tx) => {
        const [activeJob] = await tx
          .select({
            server_build_job_id: serverBuildJob.server_build_job_id,
          })
          .from(serverBuildJob)
          .where(inArray(serverBuildJob.status, this.activeJobStatuses))
          .limit(1)
          .execute();

        if (activeJob) {
          throw new ActiveBuildJobConflictError();
        }

        if (requireExistingVersion) {
          const [existingVersion] = await tx
            .select({
              server_build_version_id:
                serverBuildVersion.server_build_version_id,
            })
            .from(serverBuildVersion)
            .where(eq(serverBuildVersion.version, version))
            .limit(1)
            .execute();

          if (!existingVersion) {
            return 'version_not_found' as const;
          }

          const existingTargetVersions = await tx
            .select({
              build_type: serverBuildVersion.build_type,
            })
            .from(serverBuildVersion)
            .where(
              and(
                eq(serverBuildVersion.version, version),
                inArray(serverBuildVersion.build_type, buildTypes)
              )
            )
            .limit(1)
            .execute();

          if (existingTargetVersions.length > 0) {
            return 'build_type_exists' as const;
          }
        }

        await tx
          .insert(serverBuildJob)
          .values({
            server_build_job_id: serverBuildJobId,
            requested_by: requestedBy,
            version,
            status: EServerBuildJobStatus.queued,
            created_at: now,
            updated_at: now,
          })
          .execute();

        await tx
          .insert(serverBuildJobItem)
          .values(
            buildTypes.map((buildType) => ({
              server_build_job_item_id: uuidv7(),
              server_build_job_id: serverBuildJobId,
              build_type: buildType,
              status: EServerBuildJobItemStatus.pending,
              created_at: now,
              updated_at: now,
            }))
          )
          .execute();

        return null;
      });

      if (invalidReason) {
        return {
          conflict: false,
          invalid_reason: invalidReason,
        };
      }
    } catch (error) {
      if (
        error instanceof ActiveBuildJobConflictError ||
        this.isUniqueConflictError(error)
      ) {
        return { conflict: true };
      }

      throw error;
    }

    return {
      conflict: false,
      server_build_job_id: serverBuildJobId,
      version,
    };
  };

  getBuildJobById = async (
    serverBuildJobId: string
  ): Promise<IServerBuildJobWithItems | null> => {
    const [job] = await this.dbRw
      .select()
      .from(serverBuildJob)
      .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
      .limit(1)
      .execute();

    if (!job) {
      return null;
    }

    const items = await this.dbRw
      .select()
      .from(serverBuildJobItem)
      .where(eq(serverBuildJobItem.server_build_job_id, serverBuildJobId))
      .execute();

    return {
      server_build_job_id: job.server_build_job_id,
      requested_by: job.requested_by ?? null,
      version: job.version,
      status: job.status,
      error_message: job.error_message ?? null,
      created_at: job.created_at ?? null,
      updated_at: job.updated_at ?? null,
      started_at: job.started_at ?? null,
      finished_at: job.finished_at ?? null,
      items: this.ensureBuildTypeOrder(
        items.map((item) => this.mapJobItem(item))
      ),
    };
  };

  requestCancelForActiveJob =
    async (): Promise<ICancelServerBuildResult | null> => {
      return this.dbRw.transaction(async (tx) => {
        const now = currentTime();
        const [activeJob] = await tx
          .select({
            server_build_job_id: serverBuildJob.server_build_job_id,
            status: serverBuildJob.status,
          })
          .from(serverBuildJob)
          .where(inArray(serverBuildJob.status, this.activeJobStatuses))
          .orderBy(desc(serverBuildJob.created_at))
          .limit(1)
          .execute();

        if (!activeJob) {
          return null;
        }

        if (activeJob.status !== EServerBuildJobStatus.cancel_requested) {
          const result = await tx
            .update(serverBuildJob)
            .set({
              status: EServerBuildJobStatus.cancel_requested,
              updated_at: now,
            })
            .where(
              and(
                eq(
                  serverBuildJob.server_build_job_id,
                  activeJob.server_build_job_id
                ),
                inArray(serverBuildJob.status, [
                  EServerBuildJobStatus.queued,
                  EServerBuildJobStatus.running,
                ])
              )
            )
            .execute();

          if (result.rowCount !== 1) {
            return null;
          }
        }

        await tx
          .update(serverBuildJobItem)
          .set({
            status: EServerBuildJobItemStatus.canceled,
            error_message: null,
            updated_at: now,
            finished_at: now,
          })
          .where(
            and(
              eq(
                serverBuildJobItem.server_build_job_id,
                activeJob.server_build_job_id
              ),
              eq(serverBuildJobItem.status, EServerBuildJobItemStatus.pending)
            )
          )
          .execute();

        return {
          server_build_job_id: activeJob.server_build_job_id,
          previous_status: activeJob.status,
        };
      });
    };

  rollbackCancelRequest = async (
    serverBuildJobId: string,
    previousStatus: EServerBuildJobStatus
  ): Promise<void> => {
    if (
      previousStatus !== EServerBuildJobStatus.queued &&
      previousStatus !== EServerBuildJobStatus.running
    ) {
      return;
    }

    const now = currentTime();

    await this.dbRw.transaction(async (tx) => {
      const result = await tx
        .update(serverBuildJob)
        .set({
          status: previousStatus,
          updated_at: now,
          finished_at: null,
        })
        .where(
          and(
            eq(serverBuildJob.server_build_job_id, serverBuildJobId),
            eq(serverBuildJob.status, EServerBuildJobStatus.cancel_requested)
          )
        )
        .execute();

      if (result.rowCount !== 1) {
        return;
      }

      await tx
        .update(serverBuildJobItem)
        .set({
          status: EServerBuildJobItemStatus.pending,
          updated_at: now,
          finished_at: null,
          error_message: null,
        })
        .where(
          and(
            eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
            eq(serverBuildJobItem.status, EServerBuildJobItemStatus.canceled),
            isNull(serverBuildJobItem.started_at)
          )
        )
        .execute();
    });
  };

  markJobRunning = async (serverBuildJobId: string): Promise<boolean> => {
    const now = currentTime();
    const result = await this.dbRw
      .update(serverBuildJob)
      .set({
        status: EServerBuildJobStatus.running,
        started_at: now,
        updated_at: now,
        error_message: null,
      })
      .where(
        and(
          eq(serverBuildJob.server_build_job_id, serverBuildJobId),
          eq(serverBuildJob.status, EServerBuildJobStatus.queued)
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  claimJobItemForExecution = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<string | null> => {
    const now = currentTime();

    return this.dbRw.transaction(async (tx) => {
      const [job] = await tx
        .select({
          status: serverBuildJob.status,
          version: serverBuildJob.version,
          started_at: serverBuildJob.started_at,
        })
        .from(serverBuildJob)
        .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
        .limit(1)
        .execute();

      if (!job) {
        return null;
      }

      if (
        job.status === EServerBuildJobStatus.cancel_requested ||
        this.terminalJobStatuses.includes(job.status)
      ) {
        return null;
      }

      const claimResult = await tx
        .update(serverBuildJobItem)
        .set({
          status: EServerBuildJobItemStatus.running,
          started_at: now,
          finished_at: null,
          updated_at: now,
          error_message: null,
        })
        .where(
          and(
            eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
            eq(serverBuildJobItem.build_type, buildType),
            eq(serverBuildJobItem.status, EServerBuildJobItemStatus.pending)
          )
        )
        .execute();

      if (claimResult.rowCount !== 1) {
        return null;
      }

      await tx
        .update(serverBuildJob)
        .set({
          status: EServerBuildJobStatus.running,
          started_at: job.started_at ?? now,
          finished_at: null,
          error_message: null,
          updated_at: now,
        })
        .where(
          and(
            eq(serverBuildJob.server_build_job_id, serverBuildJobId),
            inArray(serverBuildJob.status, [
              EServerBuildJobStatus.queued,
              EServerBuildJobStatus.running,
            ])
          )
        )
        .execute();

      return job.version;
    });
  };

  isCancelRequested = async (serverBuildJobId: string): Promise<boolean> => {
    const [job] = await this.dbRw
      .select({
        status: serverBuildJob.status,
      })
      .from(serverBuildJob)
      .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
      .limit(1)
      .execute();

    if (!job) {
      return false;
    }

    return job.status === EServerBuildJobStatus.cancel_requested;
  };

  cancelJobIfNotRunning = async (serverBuildJobId: string): Promise<void> => {
    const now = currentTime();

    await this.dbRw.transaction(async (tx) => {
      const [job] = await tx
        .select({
          status: serverBuildJob.status,
        })
        .from(serverBuildJob)
        .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
        .limit(1)
        .execute();

      if (!job) {
        return;
      }

      if (
        job.status === EServerBuildJobStatus.running ||
        job.status === EServerBuildJobStatus.completed ||
        job.status === EServerBuildJobStatus.failed ||
        job.status === EServerBuildJobStatus.canceled
      ) {
        return;
      }

      await tx
        .update(serverBuildJob)
        .set({
          status: EServerBuildJobStatus.canceled,
          updated_at: now,
          finished_at: now,
        })
        .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
        .execute();

      await tx
        .update(serverBuildJobItem)
        .set({
          status: EServerBuildJobItemStatus.canceled,
          updated_at: now,
          finished_at: now,
          error_message: null,
        })
        .where(
          and(
            eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
            inArray(serverBuildJobItem.status, [
              EServerBuildJobItemStatus.pending,
              EServerBuildJobItemStatus.running,
            ])
          )
        )
        .execute();
    });
  };

  markJobItemRunning = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<void> => {
    const now = currentTime();
    await this.dbRw
      .update(serverBuildJobItem)
      .set({
        status: EServerBuildJobItemStatus.running,
        started_at: now,
        updated_at: now,
        error_message: null,
      })
      .where(
        and(
          eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
          eq(serverBuildJobItem.build_type, buildType)
        )
      )
      .execute();
  };

  touchRunningJobItem = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<void> => {
    const now = currentTime();

    await this.dbRw.transaction(async (tx) => {
      await tx
        .update(serverBuildJobItem)
        .set({
          updated_at: now,
        })
        .where(
          and(
            eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
            eq(serverBuildJobItem.build_type, buildType),
            eq(serverBuildJobItem.status, EServerBuildJobItemStatus.running)
          )
        )
        .execute();

      await tx
        .update(serverBuildJob)
        .set({
          updated_at: now,
        })
        .where(
          and(
            eq(serverBuildJob.server_build_job_id, serverBuildJobId),
            inArray(serverBuildJob.status, [
              EServerBuildJobStatus.running,
              EServerBuildJobStatus.cancel_requested,
            ])
          )
        )
        .execute();
    });
  };

  failStaleRunningItems = async (
    staleTimeoutMs: number,
    errorMessage: string
  ): Promise<string[]> => {
    const now = currentTime();
    const staleThreshold = moment
      .tz(new Date(), 'America/Sao_Paulo')
      .subtract(staleTimeoutMs, 'milliseconds')
      .format('YYYY-MM-DD HH:mm:ss');

    const staleRows = await this.dbRw
      .update(serverBuildJobItem)
      .set({
        status: EServerBuildJobItemStatus.failed,
        error_message: errorMessage,
        updated_at: now,
        finished_at: now,
      })
      .where(
        and(
          eq(serverBuildJobItem.status, EServerBuildJobItemStatus.running),
          lte(serverBuildJobItem.updated_at, staleThreshold)
        )
      )
      .returning({
        server_build_job_id: serverBuildJobItem.server_build_job_id,
      })
      .execute();

    if (staleRows.length === 0) {
      return [];
    }

    return Array.from(new Set(staleRows.map((row) => row.server_build_job_id)));
  };

  markJobItemFailed = async (
    serverBuildJobId: string,
    buildType: EServerBuildType,
    errorMessage: string
  ): Promise<void> => {
    const now = currentTime();
    await this.dbRw
      .update(serverBuildJobItem)
      .set({
        status: EServerBuildJobItemStatus.failed,
        error_message: errorMessage,
        updated_at: now,
        finished_at: now,
      })
      .where(
        and(
          eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
          eq(serverBuildJobItem.build_type, buildType)
        )
      )
      .execute();
  };

  markJobItemCanceled = async (
    serverBuildJobId: string,
    buildType: EServerBuildType,
    errorMessage: string | null = null
  ): Promise<void> => {
    const now = currentTime();
    await this.dbRw
      .update(serverBuildJobItem)
      .set({
        status: EServerBuildJobItemStatus.canceled,
        error_message: errorMessage,
        updated_at: now,
        finished_at: now,
      })
      .where(
        and(
          eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
          eq(serverBuildJobItem.build_type, buildType)
        )
      )
      .execute();
  };

  markJobItemSuccessAndPersistVersion = async (
    input: IMarkServerBuildItemSuccessInput
  ): Promise<void> => {
    const now = currentTime();
    await this.dbRw.transaction(async (tx) => {
      await tx
        .update(serverBuildVersion)
        .set({
          is_default: false,
          updated_at: now,
        })
        .where(eq(serverBuildVersion.build_type, input.build_type))
        .execute();

      await tx
        .insert(serverBuildVersion)
        .values({
          server_build_version_id: uuidv7(),
          build_type: input.build_type,
          version: input.version,
          harbor_registry: input.harbor_registry,
          harbor_repository: input.harbor_repository,
          image_reference: input.image_reference,
          is_default: true,
          created_at: now,
          updated_at: now,
        })
        .execute();

      await tx
        .update(serverBuildJobItem)
        .set({
          status: EServerBuildJobItemStatus.success,
          image_reference: input.image_reference,
          error_message: null,
          updated_at: now,
          finished_at: now,
        })
        .where(
          and(
            eq(
              serverBuildJobItem.server_build_job_id,
              input.server_build_job_id
            ),
            eq(serverBuildJobItem.build_type, input.build_type)
          )
        )
        .execute();

      await this.keepOnlyLastFiveVersions(tx, input.build_type);
    });
  };

  retryFailedJobItem = async (
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<string | null> => {
    const now = currentTime();

    try {
      return await this.dbRw.transaction(async (tx) => {
        const [job] = await tx
          .select({
            status: serverBuildJob.status,
            version: serverBuildJob.version,
            started_at: serverBuildJob.started_at,
          })
          .from(serverBuildJob)
          .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
          .limit(1)
          .execute();

        if (!job) {
          return null;
        }

        if (!this.terminalJobStatuses.includes(job.status)) {
          return null;
        }

        const [otherActiveJob] = await tx
          .select({
            server_build_job_id: serverBuildJob.server_build_job_id,
          })
          .from(serverBuildJob)
          .where(
            and(
              inArray(serverBuildJob.status, this.activeJobStatuses),
              ne(serverBuildJob.server_build_job_id, serverBuildJobId)
            )
          )
          .limit(1)
          .execute();

        if (otherActiveJob) {
          return null;
        }

        const retryResult = await tx
          .update(serverBuildJobItem)
          .set({
            status: EServerBuildJobItemStatus.pending,
            image_reference: null,
            error_message: null,
            started_at: null,
            finished_at: null,
            updated_at: now,
          })
          .where(
            and(
              eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
              eq(serverBuildJobItem.build_type, buildType),
              eq(serverBuildJobItem.status, EServerBuildJobItemStatus.failed)
            )
          )
          .execute();

        if (retryResult.rowCount !== 1) {
          return null;
        }

        await tx
          .update(serverBuildJob)
          .set({
            status: EServerBuildJobStatus.running,
            started_at: job.started_at,
            finished_at: null,
            error_message: null,
            updated_at: now,
          })
          .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
          .execute();

        return job.version;
      });
    } catch (error) {
      if (this.isUniqueConflictError(error)) {
        return null;
      }

      throw error;
    }
  };

  syncJobStatusFromItems = async (
    serverBuildJobId: string
  ): Promise<EServerBuildJobStatus | null> => {
    const now = currentTime();

    return this.dbRw.transaction(async (tx) => {
      const [job] = await tx
        .select({
          status: serverBuildJob.status,
          started_at: serverBuildJob.started_at,
          error_message: serverBuildJob.error_message,
        })
        .from(serverBuildJob)
        .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
        .limit(1)
        .execute();

      if (!job) {
        return null;
      }

      const items = await tx
        .select({
          status: serverBuildJobItem.status,
          error_message: serverBuildJobItem.error_message,
        })
        .from(serverBuildJobItem)
        .where(eq(serverBuildJobItem.server_build_job_id, serverBuildJobId))
        .execute();

      if (items.length === 0) {
        return job.status;
      }

      const hasRunningOrPending = items.some(
        (item) =>
          item.status === EServerBuildJobItemStatus.running ||
          item.status === EServerBuildJobItemStatus.pending
      );

      let nextStatus: EServerBuildJobStatus;
      let nextErrorMessage: string | null = null;
      let nextFinishedAt: string | null = null;

      if (hasRunningOrPending) {
        nextStatus =
          job.status === EServerBuildJobStatus.cancel_requested
            ? EServerBuildJobStatus.cancel_requested
            : EServerBuildJobStatus.running;
      } else if (
        items.every((item) => item.status === EServerBuildJobItemStatus.success)
      ) {
        nextStatus = EServerBuildJobStatus.completed;
      } else if (job.status === EServerBuildJobStatus.cancel_requested) {
        nextStatus = EServerBuildJobStatus.canceled;
      } else if (
        items.some((item) => item.status === EServerBuildJobItemStatus.failed)
      ) {
        nextStatus = EServerBuildJobStatus.failed;
        nextErrorMessage =
          items.find((item) => item.status === EServerBuildJobItemStatus.failed)
            ?.error_message ??
          job.error_message ??
          null;
      } else {
        nextStatus = EServerBuildJobStatus.canceled;
      }

      if (!hasRunningOrPending) {
        nextFinishedAt = now;
      }

      await tx
        .update(serverBuildJob)
        .set({
          status: nextStatus,
          started_at: job.started_at,
          finished_at: nextFinishedAt,
          error_message:
            nextStatus === EServerBuildJobStatus.completed
              ? null
              : nextErrorMessage,
          updated_at: now,
        })
        .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
        .execute();

      return nextStatus;
    });
  };

  markJobFailed = async (
    serverBuildJobId: string,
    errorMessage: string
  ): Promise<void> => {
    const now = currentTime();
    await this.dbRw
      .update(serverBuildJob)
      .set({
        status: EServerBuildJobStatus.failed,
        error_message: errorMessage,
        updated_at: now,
        finished_at: now,
      })
      .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
      .execute();
  };

  markJobCompleted = async (serverBuildJobId: string): Promise<void> => {
    const now = currentTime();
    await this.dbRw
      .update(serverBuildJob)
      .set({
        status: EServerBuildJobStatus.completed,
        error_message: null,
        updated_at: now,
        finished_at: now,
      })
      .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
      .execute();
  };

  markJobCanceled = async (
    serverBuildJobId: string,
    errorMessage: string | null = null
  ): Promise<void> => {
    const now = currentTime();
    await this.dbRw.transaction(async (tx) => {
      await tx
        .update(serverBuildJob)
        .set({
          status: EServerBuildJobStatus.canceled,
          error_message: errorMessage,
          updated_at: now,
          finished_at: now,
        })
        .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
        .execute();

      await tx
        .update(serverBuildJobItem)
        .set({
          status: EServerBuildJobItemStatus.canceled,
          error_message: errorMessage,
          updated_at: now,
          finished_at: now,
        })
        .where(
          and(
            eq(serverBuildJobItem.server_build_job_id, serverBuildJobId),
            inArray(serverBuildJobItem.status, [
              EServerBuildJobItemStatus.pending,
              EServerBuildJobItemStatus.running,
            ])
          )
        )
        .execute();
    });
  };

  hasActiveBuildJob = async (): Promise<boolean> => {
    const [activeJob] = await this.dbRw
      .select({
        server_build_job_id: serverBuildJob.server_build_job_id,
      })
      .from(serverBuildJob)
      .where(inArray(serverBuildJob.status, this.activeJobStatuses))
      .limit(1)
      .execute();

    return Boolean(activeJob?.server_build_job_id);
  };

  setDefaultVersion = async (
    serverBuildVersionId: string
  ): Promise<ServerBuildDefaultResponse | null> => {
    const now = currentTime();

    const version = await this.dbRw.transaction(async (tx) => {
      const [selected] = await tx
        .select()
        .from(serverBuildVersion)
        .where(
          eq(serverBuildVersion.server_build_version_id, serverBuildVersionId)
        )
        .limit(1)
        .execute();

      if (!selected) {
        return null;
      }

      await tx
        .update(serverBuildVersion)
        .set({
          is_default: false,
          updated_at: now,
        })
        .where(eq(serverBuildVersion.build_type, selected.build_type))
        .execute();

      await tx
        .update(serverBuildVersion)
        .set({
          is_default: true,
          updated_at: now,
        })
        .where(
          eq(serverBuildVersion.server_build_version_id, serverBuildVersionId)
        )
        .execute();

      const [updated] = await tx
        .select()
        .from(serverBuildVersion)
        .where(
          eq(serverBuildVersion.server_build_version_id, serverBuildVersionId)
        )
        .limit(1)
        .execute();

      if (!updated) {
        return null;
      }

      return this.mapVersion(updated);
    });

    return version;
  };

  getBuildJobSummaryById = async (
    serverBuildJobId: string
  ): Promise<{
    server_build_job_id: string;
    version: string;
    status: EServerBuildJobStatus;
  } | null> => {
    const [job] = await this.dbRw
      .select({
        server_build_job_id: serverBuildJob.server_build_job_id,
        version: serverBuildJob.version,
        status: serverBuildJob.status,
      })
      .from(serverBuildJob)
      .where(eq(serverBuildJob.server_build_job_id, serverBuildJobId))
      .limit(1)
      .execute();

    return job ?? null;
  };

  getBuildVersionById = async (
    serverBuildVersionId: string
  ): Promise<ServerBuildVersion | null> => {
    const [version] = await this.dbRw
      .select()
      .from(serverBuildVersion)
      .where(
        eq(serverBuildVersion.server_build_version_id, serverBuildVersionId)
      )
      .limit(1)
      .execute();

    return version ? this.mapVersion(version) : null;
  };

  hasActiveBuildJobForVersion = async (version: string): Promise<boolean> => {
    const [activeJob] = await this.dbRw
      .select({
        server_build_job_id: serverBuildJob.server_build_job_id,
      })
      .from(serverBuildJob)
      .where(
        and(
          eq(serverBuildJob.version, version),
          inArray(serverBuildJob.status, this.activeJobStatuses)
        )
      )
      .limit(1)
      .execute();

    return Boolean(activeJob?.server_build_job_id);
  };

  hardDeleteBuildVersionById = async (
    serverBuildVersionId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(serverBuildVersion)
      .where(
        and(
          eq(serverBuildVersion.server_build_version_id, serverBuildVersionId),
          eq(serverBuildVersion.is_default, false)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  isBuildVersionDefault = async (version: string): Promise<boolean> => {
    const [versionRow] = await this.dbRw
      .select({
        server_build_version_id: serverBuildVersion.server_build_version_id,
      })
      .from(serverBuildVersion)
      .where(
        and(
          eq(serverBuildVersion.version, version),
          eq(serverBuildVersion.is_default, true)
        )
      )
      .limit(1)
      .execute();

    return Boolean(versionRow?.server_build_version_id);
  };

  hardDeleteBuildByVersion = async (
    version: string
  ): Promise<IDeleteServerBuildResult> => {
    return this.dbRw.transaction(async (tx) => {
      const jobRows = await tx
        .select({
          server_build_job_id: serverBuildJob.server_build_job_id,
        })
        .from(serverBuildJob)
        .where(eq(serverBuildJob.version, version))
        .execute();

      const jobIds = jobRows.map((row) => row.server_build_job_id);
      let deletedJobItems = 0;

      if (jobIds.length > 0) {
        const deletedItemsResult = await tx
          .delete(serverBuildJobItem)
          .where(inArray(serverBuildJobItem.server_build_job_id, jobIds))
          .execute();
        deletedJobItems = deletedItemsResult.rowCount ?? 0;
      }

      const deletedJobsResult = await tx
        .delete(serverBuildJob)
        .where(eq(serverBuildJob.version, version))
        .execute();

      const deletedVersionsResult = await tx
        .delete(serverBuildVersion)
        .where(eq(serverBuildVersion.version, version))
        .execute();

      return {
        version,
        deleted_jobs: deletedJobsResult.rowCount ?? 0,
        deleted_job_items: deletedJobItems,
        deleted_versions: deletedVersionsResult.rowCount ?? 0,
      };
    });
  };

  pairBuildVersionFromHarbor = async (
    input: IHarborBuildVersionByType
  ): Promise<{
    imported: boolean;
    created_jobs: number;
    created_versions: number;
  }> => {
    const availableImages = this.buildTypes.flatMap((buildType) => {
      const harborRepository = input.harbor_repositories[buildType];
      const imageReference = input.image_references[buildType];

      return harborRepository && imageReference
        ? [{ buildType, harborRepository, imageReference }]
        : [];
    });

    if (availableImages.length === 0) {
      return {
        imported: false,
        created_jobs: 0,
        created_versions: 0,
      };
    }

    const baseNow = currentTime();
    const dateFromHarbor = input.created_at ? new Date(input.created_at) : null;
    const normalizedDate =
      dateFromHarbor && !Number.isNaN(dateFromHarbor.getTime())
        ? dateFromHarbor.toISOString()
        : baseNow;

    return this.dbRw.transaction(async (tx) => {
      let createdVersions = 0;
      let createdJobs = 0;
      let imported = false;

      for (const image of availableImages) {
        const result = await tx
          .insert(serverBuildVersion)
          .values({
            server_build_version_id: uuidv7(),
            build_type: image.buildType,
            version: input.version,
            harbor_registry: buildEnvironment.harborRegistry,
            harbor_repository: image.harborRepository,
            image_reference: image.imageReference,
            is_default: false,
            created_at: normalizedDate,
            updated_at: normalizedDate,
          })
          .onConflictDoNothing()
          .execute();

        const rowCount = result.rowCount ?? 0;
        if (rowCount > 0) {
          createdVersions += rowCount;
          imported = true;
        }

        await this.keepOnlyLastFiveVersions(tx, image.buildType);
        await this.ensureDefaultVersionWhenMissing(
          tx,
          image.buildType,
          input.version,
          baseNow
        );
      }

      const [existingJob] = await tx
        .select({
          server_build_job_id: serverBuildJob.server_build_job_id,
        })
        .from(serverBuildJob)
        .where(eq(serverBuildJob.version, input.version))
        .limit(1)
        .execute();

      const serverBuildJobId = existingJob?.server_build_job_id ?? uuidv7();

      if (!existingJob) {
        await tx
          .insert(serverBuildJob)
          .values({
            server_build_job_id: serverBuildJobId,
            requested_by: null,
            version: input.version,
            status: EServerBuildJobStatus.completed,
            error_message: null,
            created_at: normalizedDate,
            updated_at: normalizedDate,
            started_at: normalizedDate,
            finished_at: normalizedDate,
          })
          .execute();

        createdJobs = 1;
        imported = true;
      }

      const jobItemsResult = await tx
        .insert(serverBuildJobItem)
        .values(
          availableImages.map((image) => ({
            server_build_job_item_id: uuidv7(),
            server_build_job_id: serverBuildJobId,
            build_type: image.buildType,
            status: EServerBuildJobItemStatus.success,
            image_reference: image.imageReference,
            error_message: null,
            created_at: normalizedDate,
            updated_at: normalizedDate,
            started_at: normalizedDate,
            finished_at: normalizedDate,
          }))
        )
        .onConflictDoNothing()
        .execute();

      if ((jobItemsResult.rowCount ?? 0) > 0) {
        imported = true;
      }

      return {
        imported,
        created_jobs: createdJobs,
        created_versions: createdVersions,
      };
    });
  };

  getDefaultImages = async (): Promise<IServerBuildDefaultImages | null> => {
    const defaults = await this.dbRw
      .select({
        build_type: serverBuildVersion.build_type,
        image_reference: serverBuildVersion.image_reference,
      })
      .from(serverBuildVersion)
      .where(
        and(
          eq(serverBuildVersion.is_default, true),
          inArray(serverBuildVersion.build_type, this.buildTypes)
        )
      )
      .execute();

    const imageMap = new Map(
      defaults.map((item) => [item.build_type, item.image_reference])
    );

    const baileys = imageMap.get(EServerBuildType.baileys);
    const wwebjs = imageMap.get(EServerBuildType.wwebjs);
    const whatsmeow = imageMap.get(EServerBuildType.whatsmeow);
    const balanceApi = imageMap.get(EServerBuildType.balance_api);

    if (!baileys || !wwebjs || !whatsmeow || !balanceApi) {
      return null;
    }

    return {
      baileys,
      wwebjs,
      whatsmeow,
      balance_api: balanceApi,
    };
  };
}
