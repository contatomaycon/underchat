import * as schema from '@core/models';
import {
  serverBuildJob,
  serverBuildJobItem,
  serverBuildVersion,
} from '@core/models';
import { currentTime } from '@core/common/functions/currentTime';
import { EServerBuildJobItemStatus } from '@core/common/enums/EServerBuildJobItemStatus';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  ServerBuildJob,
  ServerBuildJobItem,
  ServerBuildVersion,
  ServerBuildViewResponse,
} from '@core/schema/server/viewServerBuild/response.schema';
import { ServerBuildDefaultResponse } from '@core/schema/server/setServerBuildDefault/response.schema';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

class ActiveBuildJobConflictError extends Error {
  constructor() {
    super('Active build job already exists');
  }
}

interface ICreateBuildJobResult {
  conflict: boolean;
  server_build_job_id?: string;
  version?: string;
}

interface ICancelBuildResult {
  server_build_job_id: string;
  previous_status: EServerBuildJobStatus;
}

interface IMarkBuildItemSuccessInput {
  server_build_job_id: string;
  build_type: EServerBuildType;
  version: string;
  harbor_registry: string;
  harbor_repository: string;
  image_reference: string;
}

type ServerBuildJobRow = typeof serverBuildJob.$inferSelect;
type ServerBuildJobItemRow = typeof serverBuildJobItem.$inferSelect;
type ServerBuildVersionRow = typeof serverBuildVersion.$inferSelect;
type ServerBuildJobWithItemsRow = ServerBuildJobRow & {
  items: ServerBuildJobItem[];
};

@injectable()
export class ServerBuildService {
  private readonly activeJobStatuses: EServerBuildJobStatus[] = [
    EServerBuildJobStatus.queued,
    EServerBuildJobStatus.running,
    EServerBuildJobStatus.cancel_requested,
  ];

  private readonly buildTypes: EServerBuildType[] = [
    EServerBuildType.baileys,
    EServerBuildType.wwebjs,
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

  private generateVersion(): string {
    const date = new Date();
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');

    return `v${yyyy}${mm}${dd}${hh}${min}${ss}${ms}`;
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

  async listBuilds(): Promise<ServerBuildViewResponse> {
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

    const [baileys, wwebjs, balanceApi] = await Promise.all(
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
      versions_by_type: {
        [EServerBuildType.baileys]: baileys.map((item) =>
          this.mapVersion(item)
        ),
        [EServerBuildType.wwebjs]: wwebjs.map((item) => this.mapVersion(item)),
        [EServerBuildType.balance_api]: balanceApi.map((item) =>
          this.mapVersion(item)
        ),
      },
    };
  }

  async createBuildJob(requestedBy: string): Promise<ICreateBuildJobResult> {
    const serverBuildJobId = uuidv7();
    const now = currentTime();
    const version = this.generateVersion();

    try {
      await this.dbRw.transaction(async (tx) => {
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
            this.buildTypes.map((buildType) => ({
              server_build_job_item_id: uuidv7(),
              server_build_job_id: serverBuildJobId,
              build_type: buildType,
              status: EServerBuildJobItemStatus.pending,
              created_at: now,
              updated_at: now,
            }))
          )
          .execute();
      });
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
  }

  async getBuildJobById(
    serverBuildJobId: string
  ): Promise<ServerBuildJobWithItemsRow | null> {
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
      ...job,
      items: this.ensureBuildTypeOrder(
        items.map((item) => this.mapJobItem(item))
      ),
    };
  }

  async requestCancelForActiveJob(): Promise<ICancelBuildResult | null> {
    const [activeJob] = await this.dbRw
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
      const result = await this.dbRw
        .update(serverBuildJob)
        .set({
          status: EServerBuildJobStatus.cancel_requested,
          updated_at: currentTime(),
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

    return {
      server_build_job_id: activeJob.server_build_job_id,
      previous_status: activeJob.status,
    };
  }

  async rollbackCancelRequest(
    serverBuildJobId: string,
    previousStatus: EServerBuildJobStatus
  ): Promise<void> {
    if (
      previousStatus !== EServerBuildJobStatus.queued &&
      previousStatus !== EServerBuildJobStatus.running
    ) {
      return;
    }

    await this.dbRw
      .update(serverBuildJob)
      .set({
        status: previousStatus,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(serverBuildJob.server_build_job_id, serverBuildJobId),
          eq(serverBuildJob.status, EServerBuildJobStatus.cancel_requested)
        )
      )
      .execute();
  }

  async markJobRunning(serverBuildJobId: string): Promise<boolean> {
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
  }

  async isCancelRequested(serverBuildJobId: string): Promise<boolean> {
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
  }

  async cancelJobIfNotRunning(serverBuildJobId: string): Promise<void> {
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
  }

  async markJobItemRunning(
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<void> {
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
  }

  async markJobItemFailed(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    errorMessage: string
  ): Promise<void> {
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
  }

  async markJobItemCanceled(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    errorMessage: string | null = null
  ): Promise<void> {
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
  }

  async markJobItemSuccessAndPersistVersion(
    input: IMarkBuildItemSuccessInput
  ): Promise<void> {
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
  }

  async markJobFailed(
    serverBuildJobId: string,
    errorMessage: string
  ): Promise<void> {
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
  }

  async markJobCompleted(serverBuildJobId: string): Promise<void> {
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
  }

  async markJobCanceled(
    serverBuildJobId: string,
    errorMessage: string | null = null
  ): Promise<void> {
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
  }

  async setDefaultVersion(
    serverBuildVersionId: string
  ): Promise<ServerBuildDefaultResponse | null> {
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
  }

  async getDefaultImages(): Promise<IServerBuildDefaultImages | null> {
    const defaults = await this.dbRo
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
    const balanceApi = imageMap.get(EServerBuildType.balance_api);

    if (!baileys || !wwebjs || !balanceApi) {
      return null;
    }

    return {
      baileys,
      wwebjs,
      balance_api: balanceApi,
    };
  }
}
