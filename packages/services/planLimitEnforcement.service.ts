import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import {
  ExtractTablesWithRelations,
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from '@core/models';
import {
  account,
  aiAgent,
  chatbot,
  permissionAssignment,
  permissionRole,
  plan,
  planAccount,
  planCrossSell,
  planCrossSellAccount,
  planItems,
  planLimitEnforcementCheckpoint,
  user,
  worker,
  workerWhatsappOfficialConnection,
} from '@core/models';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EChatbotStatus } from '@core/common/enums/EChatbotStatus';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { currentTime } from '@core/common/functions/currentTime';
import { withLock } from '@core/common/functions/withLock';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { UserSessionInvalidationService } from '@core/services/userSessionInvalidation.service';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';

export type PlanLimitResource =
  'user' | 'worker' | 'chatbot' | 'role' | 'ai_agent';

interface PlanLimitUsage {
  allowed: number;
  active: number;
  available: number;
  planIsActive: boolean;
}

interface PlanLimitUsageRow {
  allowed: number | string;
  active: number | string;
  plan_is_active: boolean | number | string;
}

interface WorkerBlockCandidate {
  worker_id: string;
  account_id: string;
  server_id: string | null;
  worker_type_id: string;
  session_storage: EWorkerSessionStorage;
  worker_status_id: string;
  lifecycle_operation_id: string | null;
  updated_at: string | null;
}

type DatabaseTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

const RESOURCE_PRODUCTS: Record<PlanLimitResource, EPlanProduct> = {
  user: EPlanProduct.user,
  worker: EPlanProduct.worker,
  chatbot: EPlanProduct.chatbot,
  role: EPlanProduct.role,
  ai_agent: EPlanProduct.ai_agent,
};

const SYSTEM_ROLE_IDS = [EPermissionRole.master, EPermissionRole.administrator];

const BLOCKED_WORKER_STATUSES = [
  EWorkerStatus.blocked,
  EWorkerStatus.stopped,
  EWorkerStatus.delete,
  EWorkerStatus.deleting,
];

const ENFORCED_RESOURCES: PlanLimitResource[] = [
  'user',
  'worker',
  'chatbot',
  'role',
  'ai_agent',
];

const asBoolean = (value: unknown): boolean =>
  value === true || value === 'true' || value === 1 || value === '1';

const asNonNegativeInteger = (value: unknown): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(Math.trunc(numericValue), 0)
    : 0;
};

@injectable()
export class PlanLimitEnforcementService {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('Redis') private readonly redis: Redis,
    @inject(UserSessionInvalidationService)
    private readonly userSessionInvalidationService: UserSessionInvalidationService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async listDueAccountIds(limit = 100): Promise<string[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(Math.trunc(limit), 0)
      : 0;
    if (safeLimit === 0) {
      return [];
    }

    const result = await this.dbRw.execute<{ account_id: string }>(sql`
      WITH latest_plan AS MATERIALIZED (
        SELECT DISTINCT ON (pa.account_id)
          pa.account_id,
          pa.next_payment_date
        FROM ${planAccount} pa
        ORDER BY
          pa.account_id,
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
      )
      SELECT a.account_id
      FROM ${account} a
      INNER JOIN latest_plan lp
        ON lp.account_id = a.account_id
      LEFT JOIN ${planLimitEnforcementCheckpoint} checkpoint
        ON checkpoint.account_id = a.account_id
      WHERE a.deleted_at IS NULL
        AND a.account_status_id <> ${EAccountStatus.blocked}::uuid
        AND lp.next_payment_date > NOW()
        AND (
          checkpoint.last_checked_at IS NULL
          OR checkpoint.last_checked_at < NOW() - INTERVAL '24 hours'
        )
      ORDER BY
        COALESCE(
          checkpoint.last_checked_at,
          '-infinity'::timestamptz
        ) ASC,
        COALESCE(
          checkpoint.last_started_at,
          '-infinity'::timestamptz
        ) ASC,
        a.account_id ASC
      LIMIT ${safeLimit}
    `);

    return result.rows.map((row) => row.account_id);
  }

  async enforceDueAccounts(limit = 100): Promise<void> {
    const accountIds = await this.listDueAccountIds(limit);

    for (const accountId of accountIds) {
      try {
        await this.enforceAccountWithCheckpoint(accountId);
      } catch (error) {
        console.error('Plan limit enforcement failed for account', {
          account_id: accountId,
          error,
        });
      }
    }
  }

  async enforceAccountWithCheckpoint(accountId: string): Promise<void> {
    await this.markCheckpointStarted(accountId);

    try {
      await this.enforceAccount(accountId);
      await this.markCheckpointSucceeded(accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markCheckpointFailed(accountId, message);
      throw error;
    }
  }

  async enforceAccount(accountId: string): Promise<void> {
    await withLock(
      this.redis,
      `plan-limit-enforcement:${accountId}`,
      async () => {
        const unresolvedExcesses: string[] = [];

        for (const resource of ENFORCED_RESOURCES) {
          await withLock(
            this.redis,
            this.getResourceLockKey(accountId, resource),
            async () => {
              const usage = await this.getUsage(accountId, resource);
              const excess = usage.active - usage.allowed;
              this.logUsage(
                'Plan limit usage evaluated',
                accountId,
                resource,
                usage
              );

              if (!usage.planIsActive) {
                this.logUsage(
                  'Plan limit enforcement abstained because plan is inactive',
                  accountId,
                  resource,
                  usage,
                  'warn'
                );
                return;
              }

              if (excess <= 0) {
                return;
              }

              const blocked = await this.blockExcess(
                accountId,
                resource,
                excess
              );
              if (blocked < excess) {
                const finalUsage = await this.getUsage(accountId, resource);
                const remainingExcess = Math.max(
                  finalUsage.active - finalUsage.allowed,
                  0
                );
                this.logUsage(
                  'Plan limit usage checked after blocking',
                  accountId,
                  resource,
                  finalUsage
                );
                if (finalUsage.planIsActive && remainingExcess > 0) {
                  unresolvedExcesses.push(
                    `${resource}: excess=${remainingExcess}, blocked=${blocked}`
                  );
                }
              }
            },
            {
              ttlMs: 60000,
              retryMs: 100,
              maxWaitMs: 3000,
            }
          );
        }

        if (unresolvedExcesses.length > 0) {
          throw new Error(
            `plan_limit_unresolved_excess: ${unresolvedExcesses.join('; ')}`
          );
        }
      },
      {
        ttlMs: 120000,
        retryMs: 250,
        maxWaitMs: 1000,
      }
    );
  }

  async getUsage(
    accountId: string,
    resource: PlanLimitResource
  ): Promise<PlanLimitUsage> {
    return this.getUsageFromDatabase(this.dbRw, accountId, resource);
  }

  async ensureCanActivate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    resource: PlanLimitResource
  ): Promise<void> {
    await withLock(
      this.redis,
      this.getResourceLockKey(accountId, resource),
      async () => this.ensureCanActivateUnlocked(t, accountId, resource),
      {
        ttlMs: 20000,
        retryMs: 100,
        maxWaitMs: 3000,
      }
    );
  }

  async ensureCanActivateUserIfNeeded(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string
  ): Promise<void> {
    const currentStatus = await this.getUserStatus(accountId, userId);

    if (currentStatus === EUserStatus.active) {
      return;
    }

    if (await this.isProtectedUser(userId)) {
      return;
    }

    await this.ensureCanActivate(t, accountId, 'user');
  }

  async ensureCanActivateAiAgentIfNeeded(
    t: TFunction<'translation', undefined>,
    accountId: string,
    aiAgentId: string
  ): Promise<void> {
    const currentStatus = await this.getAiAgentStatus(accountId, aiAgentId);

    if (currentStatus === EAiAgentStatus.active) {
      return;
    }

    await this.ensureCanActivate(t, accountId, 'ai_agent');
  }

  async blockUser(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string
  ): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'user'),
      async () => {
        if (await this.isProtectedUser(userId)) {
          throw new Error(t('cannot_block_system_user'));
        }

        return this.blockUserUnlocked(accountId, userId);
      },
      { ttlMs: 20000 }
    );
  }

  async unblockUser(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string
  ): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'user'),
      async () => {
        const currentStatus = await this.getUserStatus(accountId, userId);

        if (!currentStatus) {
          throw new Error(t('user_not_found'));
        }

        if (currentStatus === EUserStatus.active) {
          return true;
        }

        const isProtectedUser = await this.isProtectedUser(userId);
        if (!isProtectedUser) {
          await this.ensureCanActivateUnlocked(t, accountId, 'user');
        }

        const updated = await this.dbRw
          .update(user)
          .set({
            user_status_id: EUserStatus.active,
          })
          .where(
            and(
              eq(user.account_id, accountId),
              eq(user.user_id, userId),
              eq(user.user_status_id, currentStatus),
              isNull(user.deleted_at)
            )
          )
          .execute();

        return updated.rowCount === 1;
      },
      { ttlMs: 20000 }
    );
  }

  async activateProtectedUserIfBlocked(
    accountId: string,
    userId: string
  ): Promise<boolean> {
    if (!(await this.isProtectedUser(userId))) {
      return false;
    }

    const updated = await this.dbRw
      .update(user)
      .set({
        user_status_id: EUserStatus.active,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_id, userId),
          eq(user.user_status_id, EUserStatus.blocked),
          isNull(user.deleted_at)
        )
      )
      .execute();

    return updated.rowCount === 1;
  }

  async blockWorker(accountId: string, workerId: string): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'worker'),
      async () => this.blockWorkerUnlocked(accountId, workerId),
      { ttlMs: 30000 }
    );
  }

  async unblockWorker(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'worker'),
      async () => {
        const current = await this.getWorker(accountId, workerId);

        if (!current) {
          throw new Error(t('worker_not_found'));
        }

        if (current.worker_status_id !== EWorkerStatus.blocked) {
          return true;
        }

        await this.ensureCanActivateUnlocked(t, accountId, 'worker');

        const restoredWorkerStatusId =
          await this.resolveWorkerStatusAfterPlanUnblock(current);

        const updated = await this.dbRw
          .update(worker)
          .set({
            worker_status_id: restoredWorkerStatusId,
            lifecycle_operation_id: null,
            updated_at: currentTime(),
          })
          .where(
            and(
              eq(worker.account_id, accountId),
              eq(worker.worker_id, workerId),
              eq(worker.worker_status_id, current.worker_status_id),
              current.lifecycle_operation_id
                ? eq(
                    worker.lifecycle_operation_id,
                    current.lifecycle_operation_id
                  )
                : isNull(worker.lifecycle_operation_id),
              current.server_id
                ? eq(worker.server_id, current.server_id)
                : isNull(worker.server_id),
              eq(worker.worker_type_id, current.worker_type_id),
              current.updated_at
                ? eq(worker.updated_at, current.updated_at)
                : isNull(worker.updated_at),
              isNull(worker.deleted_at)
            )
          )
          .execute();

        if (updated.rowCount === 1) {
          await this.publishWorkerStatus({
            ...current,
            worker_status_id: restoredWorkerStatusId,
          });
        }

        return updated.rowCount === 1;
      },
      { ttlMs: 30000 }
    );
  }

  /**
   * Managed WhatsApp providers return to the pairing-ready state after a plan
   * block. Official WhatsApp has no runtime or QR bootstrap, so its active
   * Meta connection is the durable readiness proof and must return ONLINE.
   * An official worker without that proof remains OFFLINE until reconnected.
   */
  private async resolveWorkerStatusAfterPlanUnblock(
    current: WorkerBlockCandidate
  ): Promise<EWorkerStatus> {
    if (current.worker_type_id !== EWorkerType.whatsapp) {
      return EWorkerStatus.disponible;
    }

    const [activeConnection] = await this.dbRw
      .select({
        id: workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
      })
      .from(workerWhatsappOfficialConnection)
      .where(
        and(
          eq(workerWhatsappOfficialConnection.worker_id, current.worker_id),
          isNull(workerWhatsappOfficialConnection.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return activeConnection ? EWorkerStatus.online : EWorkerStatus.offline;
  }

  async blockChatbot(accountId: string, chatbotId: string): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'chatbot'),
      async () => this.blockChatbotUnlocked(accountId, chatbotId),
      { ttlMs: 20000 }
    );
  }

  async unblockChatbot(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatbotId: string
  ): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'chatbot'),
      async () => {
        const currentStatus = await this.getChatbotStatus(accountId, chatbotId);

        if (!currentStatus) {
          throw new Error(t('chatbot_not_found'));
        }

        if (currentStatus === EChatbotStatus.active) {
          return true;
        }

        await this.ensureCanActivateUnlocked(t, accountId, 'chatbot');

        const updated = await this.dbRw
          .update(chatbot)
          .set({ status: EChatbotStatus.active, updated_at: currentTime() })
          .where(
            and(
              eq(chatbot.account_id, accountId),
              eq(chatbot.chatbot_id, chatbotId),
              eq(chatbot.status, currentStatus)
            )
          )
          .execute();

        return updated.rowCount === 1;
      },
      { ttlMs: 20000 }
    );
  }

  async blockRole(accountId: string, roleId: string): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'role'),
      async () => this.blockRoleUnlocked(accountId, roleId),
      { ttlMs: 20000 }
    );
  }

  async unblockRole(
    t: TFunction<'translation', undefined>,
    accountId: string,
    roleId: string
  ): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'role'),
      async () => {
        this.ensureNotSystemRole(t, roleId);
        const currentStatus = await this.getRoleStatus(accountId, roleId);

        if (!currentStatus) {
          throw new Error(t('role_not_found'));
        }

        if (currentStatus === EPermissionRoleStatus.active) {
          return true;
        }

        await this.ensureCanActivateUnlocked(t, accountId, 'role');

        const updated = await this.dbRw
          .update(permissionRole)
          .set({
            status: EPermissionRoleStatus.active,
            updated_at: currentTime(),
          })
          .where(
            and(
              eq(permissionRole.account_id, accountId),
              eq(permissionRole.permission_role_id, roleId),
              eq(permissionRole.status, currentStatus),
              isNull(permissionRole.deleted_at)
            )
          )
          .execute();

        return updated.rowCount === 1;
      },
      { ttlMs: 20000 }
    );
  }

  async blockAiAgent(accountId: string, aiAgentId: string): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'ai_agent'),
      async () => this.blockAiAgentUnlocked(accountId, aiAgentId),
      { ttlMs: 20000 }
    );
  }

  async unblockAiAgent(
    t: TFunction<'translation', undefined>,
    accountId: string,
    aiAgentId: string
  ): Promise<boolean> {
    return withLock(
      this.redis,
      this.getResourceLockKey(accountId, 'ai_agent'),
      async () => {
        const currentStatus = await this.getAiAgentStatus(accountId, aiAgentId);

        if (!currentStatus) {
          throw new Error(t('ai_agent_not_found'));
        }

        if (currentStatus === EAiAgentStatus.active) {
          return true;
        }

        await this.ensureCanActivateUnlocked(t, accountId, 'ai_agent');

        const updated = await this.dbRw
          .update(aiAgent)
          .set({ status: EAiAgentStatus.active, updated_at: currentTime() })
          .where(
            and(
              eq(aiAgent.account_id, accountId),
              eq(aiAgent.ai_agent_id, aiAgentId),
              eq(aiAgent.status, currentStatus)
            )
          )
          .execute();

        return updated.rowCount === 1;
      },
      { ttlMs: 20000 }
    );
  }

  private getResourceLockKey(
    accountId: string,
    resource: PlanLimitResource
  ): string {
    return `plan-limit-enforcement:${accountId}:${resource}`;
  }

  private async blockExcess(
    accountId: string,
    resource: PlanLimitResource,
    excess: number
  ): Promise<number> {
    let blocked = 0;

    for (let attempt = 0; attempt < excess; attempt += 1) {
      const usage = await this.getUsage(accountId, resource);
      this.logUsage(
        'Plan limit usage revalidated before blocking',
        accountId,
        resource,
        usage
      );

      if (!usage.planIsActive) {
        this.logUsage(
          'Plan limit enforcement abstained during revalidation',
          accountId,
          resource,
          usage,
          'warn'
        );
        break;
      }

      if (usage.active <= usage.allowed) {
        break;
      }

      const candidateBlocked = await this.blockNextCandidate(
        accountId,
        resource
      );
      if (!candidateBlocked) {
        break;
      }
      blocked += 1;
    }

    return blocked;
  }

  private async ensureCanActivateUnlocked(
    t: TFunction<'translation', undefined>,
    accountId: string,
    resource: PlanLimitResource
  ): Promise<void> {
    const usage = await this.getUsage(accountId, resource);

    if (
      !usage.planIsActive ||
      usage.allowed <= 0 ||
      usage.active >= usage.allowed
    ) {
      throw new Error(this.formatLimitError(t, resource, usage));
    }
  }

  private async blockNextCandidate(
    accountId: string,
    resource: PlanLimitResource
  ): Promise<boolean> {
    if (resource === 'user') {
      const [candidate] = await this.listUserBlockCandidates(accountId, 1);
      return candidate
        ? this.blockUserUnlocked(accountId, candidate.user_id, true)
        : false;
    }

    if (resource === 'worker') {
      const [candidate] = await this.listWorkerBlockCandidates(accountId, 1);
      return candidate
        ? this.blockWorkerUnlocked(accountId, candidate.worker_id, true)
        : false;
    }

    if (resource === 'chatbot') {
      const [candidate] = await this.listChatbotBlockCandidates(accountId, 1);
      return candidate
        ? this.blockChatbotUnlocked(accountId, candidate.chatbot_id, true)
        : false;
    }

    if (resource === 'role') {
      const [candidate] = await this.listRoleBlockCandidates(accountId, 1);
      return candidate
        ? this.blockRoleUnlocked(accountId, candidate.permission_role_id, true)
        : false;
    }

    const [candidate] = await this.listAiAgentBlockCandidates(accountId, 1);
    return candidate
      ? this.blockAiAgentUnlocked(accountId, candidate.ai_agent_id, true)
      : false;
  }

  private buildUsageQuery(accountId: string, resource: PlanLimitResource) {
    const productId = RESOURCE_PRODUCTS[resource];
    const includedUserSeat = resource === 'user' ? 1 : 0;

    return sql<PlanLimitUsageRow>`
      WITH latest_plan AS MATERIALIZED (
        SELECT
          pa.account_id,
          pa.plan_account_id,
          pa.plan_id,
          pa.last_payment_date,
          pa.next_payment_date
        FROM ${planAccount} pa
        WHERE pa.account_id = ${accountId}::uuid
        ORDER BY
          pa.updated_at DESC NULLS LAST,
          pa.created_at DESC NULLS LAST,
          pa.plan_account_id DESC
        LIMIT 1
      ),
      plan_state AS MATERIALIZED (
        SELECT
          lp.plan_id,
          lp.last_payment_date,
          COALESCE(
            a.account_id IS NOT NULL
            AND a.deleted_at IS NULL
            AND a.account_status_id <> ${EAccountStatus.blocked}::uuid
            AND lp.plan_account_id IS NOT NULL
            AND lp.next_payment_date > NOW()
            AND p.plan_id IS NOT NULL
            AND p.deleted_at IS NULL,
            FALSE
          ) AS plan_is_active
        FROM (SELECT 1) requested
        LEFT JOIN ${account} a
          ON a.account_id = ${accountId}::uuid
        LEFT JOIN latest_plan lp
          ON lp.account_id = a.account_id
        LEFT JOIN ${plan} p
          ON p.plan_id = lp.plan_id
      ),
      entitlement AS MATERIALIZED (
        SELECT
          ps.plan_is_active,
          CASE
            WHEN ps.plan_is_active THEN
              COALESCE((
                SELECT SUM(pi.quantity)
                FROM ${planItems} pi
                WHERE pi.plan_id = ps.plan_id
                  AND pi.plan_product_id = ${productId}::uuid
                  AND pi.quantity > 0
                  AND pi.deleted_at IS NULL
              ), 0)
              + COALESCE((
                SELECT SUM(pcs.quantity)
                FROM ${planCrossSellAccount} pcsa
                INNER JOIN ${planCrossSell} pcs
                  ON pcs.plan_cross_sell_id = pcsa.plan_cross_sell_id
                WHERE pcsa.account_id = ${accountId}::uuid
                  AND pcsa.deleted_at IS NULL
                  AND pcs.deleted_at IS NULL
                  AND pcs.plan_product_id = ${productId}::uuid
                  AND pcs.quantity > 0
                  AND (
                    pcsa.cancellation_date IS NULL
                    OR ps.last_payment_date IS NULL
                    OR pcsa.cancellation_date >= ps.last_payment_date
                  )
              ), 0)
              + ${includedUserSeat}
            ELSE 0
          END::integer AS allowed
        FROM plan_state ps
      ),
      usage AS MATERIALIZED (
        SELECT CASE ${resource}
          WHEN 'user' THEN (
            SELECT COUNT(*)::integer
            FROM ${user} u
            WHERE u.account_id = ${accountId}::uuid
              AND u.user_status_id = ${EUserStatus.active}::uuid
              AND u.deleted_at IS NULL
          )
          WHEN 'worker' THEN (
            SELECT COUNT(*)::integer
            FROM ${worker} w
            WHERE w.account_id = ${accountId}::uuid
              AND w.deleted_at IS NULL
              AND w.worker_status_id NOT IN (
                ${EWorkerStatus.blocked}::uuid,
                ${EWorkerStatus.stopped}::uuid,
                ${EWorkerStatus.delete}::uuid,
                ${EWorkerStatus.deleting}::uuid
              )
          )
          WHEN 'chatbot' THEN (
            SELECT COUNT(*)::integer
            FROM ${chatbot} c
            WHERE c.account_id = ${accountId}::uuid
              AND c.status = ${EChatbotStatus.active}
          )
          WHEN 'role' THEN (
            SELECT COUNT(*)::integer
            FROM ${permissionRole} pr
            WHERE pr.account_id = ${accountId}::uuid
              AND pr.status = ${EPermissionRoleStatus.active}
              AND pr.deleted_at IS NULL
              AND pr.permission_role_id NOT IN (
                ${EPermissionRole.master}::uuid,
                ${EPermissionRole.administrator}::uuid
              )
          )
          WHEN 'ai_agent' THEN (
            SELECT COUNT(*)::integer
            FROM ${aiAgent} aa
            WHERE aa.account_id = ${accountId}::uuid
              AND aa.status = ${EAiAgentStatus.active}
          )
          ELSE 0
        END::integer AS active
      )
      SELECT
        entitlement.allowed,
        usage.active,
        entitlement.plan_is_active
      FROM entitlement
      CROSS JOIN usage
    `;
  }

  private async getUsageFromDatabase(
    database: NodePgDatabase<typeof schema> | DatabaseTransaction,
    accountId: string,
    resource: PlanLimitResource
  ): Promise<PlanLimitUsage> {
    const result = await database.execute(
      this.buildUsageQuery(accountId, resource)
    );
    const row = result.rows[0] as unknown as PlanLimitUsageRow | undefined;
    if (!row) {
      throw new Error('plan_limit_usage_returned_no_rows');
    }

    const allowed = asNonNegativeInteger(row.allowed);
    const active = asNonNegativeInteger(row.active);
    return {
      allowed,
      active,
      available: Math.max(allowed - active, 0),
      planIsActive: asBoolean(row.plan_is_active),
    };
  }

  private async executeBlockCas(
    accountId: string,
    resource: PlanLimitResource,
    enforceCurrentLimit: boolean,
    update: (transaction: DatabaseTransaction) => Promise<boolean>
  ): Promise<boolean> {
    return this.dbRw.transaction(async (transaction) => {
      if (enforceCurrentLimit) {
        await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`${accountId}:${RESOURCE_PRODUCTS[resource]}`},
              0
            )
          )
        `);
        const usage = await this.getUsageFromDatabase(
          transaction,
          accountId,
          resource
        );
        this.logUsage(
          'Plan limit usage revalidated under database lock',
          accountId,
          resource,
          usage
        );
        if (!usage.planIsActive || usage.active <= usage.allowed) {
          return false;
        }
      }

      return update(transaction);
    });
  }

  private async blockUserUnlocked(
    accountId: string,
    userId: string,
    enforceCurrentLimit = false
  ): Promise<boolean> {
    const currentStatus = await this.getUserStatus(accountId, userId);

    if (!currentStatus) {
      return false;
    }

    if (await this.isProtectedUser(userId)) {
      return false;
    }

    if (currentStatus === EUserStatus.blocked) {
      return true;
    }

    const blocked = await this.executeBlockCas(
      accountId,
      'user',
      enforceCurrentLimit,
      async (transaction) => {
        const updated = await transaction
          .update(user)
          .set({
            user_status_id: EUserStatus.blocked,
          })
          .where(
            and(
              eq(user.account_id, accountId),
              eq(user.user_id, userId),
              eq(user.user_status_id, currentStatus),
              isNull(user.deleted_at),
              sql`NOT EXISTS (
                SELECT 1
                FROM "permission_assignment" pa
                WHERE pa.user_id = ${user.user_id}
                  AND pa.permission_role_id IN (
                    ${EPermissionRole.master},
                    ${EPermissionRole.administrator}
                  )
              )`
            )
          )
          .execute();
        return updated.rowCount === 1;
      }
    );

    if (blocked) {
      this.logBlock(accountId, 'user', userId, enforceCurrentLimit);
      await this.userSessionInvalidationService.invalidateUser(
        accountId,
        userId
      );
    }

    return blocked;
  }

  private async blockWorkerUnlocked(
    accountId: string,
    workerId: string,
    enforceCurrentLimit = false
  ): Promise<boolean> {
    const current = await this.getWorker(accountId, workerId);

    if (!current) {
      return false;
    }

    if (current.worker_status_id === EWorkerStatus.blocked) {
      return true;
    }

    const operationId = uuidv7();
    const cleanupMessage = current.server_id
      ? this.buildWorkerCleanupMessage(current, operationId)
      : null;
    if (cleanupMessage) {
      await this.workerLifecycleQueueService.prepare(cleanupMessage);
    }
    const blocked = await this.executeBlockCas(
      accountId,
      'worker',
      enforceCurrentLimit,
      async (transaction) => {
        const updated = await transaction
          .update(worker)
          .set({
            worker_status_id: EWorkerStatus.blocked,
            lifecycle_operation_id: current.server_id ? operationId : null,
            updated_at: currentTime(),
          })
          .where(
            and(
              eq(worker.account_id, accountId),
              eq(worker.worker_id, workerId),
              eq(worker.worker_status_id, current.worker_status_id),
              current.lifecycle_operation_id
                ? eq(
                    worker.lifecycle_operation_id,
                    current.lifecycle_operation_id
                  )
                : isNull(worker.lifecycle_operation_id),
              current.server_id
                ? eq(worker.server_id, current.server_id)
                : isNull(worker.server_id),
              eq(worker.worker_type_id, current.worker_type_id),
              current.updated_at
                ? eq(worker.updated_at, current.updated_at)
                : isNull(worker.updated_at),
              isNull(worker.deleted_at)
            )
          )
          .execute();
        return updated.rowCount === 1;
      }
    );

    if (!blocked) {
      return false;
    }

    this.logBlock(accountId, 'worker', workerId, enforceCurrentLimit);
    await this.publishWorkerStatus({
      ...current,
      worker_status_id: EWorkerStatus.blocked,
    });

    if (cleanupMessage) {
      await this.workerLifecycleQueueService.publish(cleanupMessage);
    }

    return true;
  }

  private async blockChatbotUnlocked(
    accountId: string,
    chatbotId: string,
    enforceCurrentLimit = false
  ): Promise<boolean> {
    const currentStatus = await this.getChatbotStatus(accountId, chatbotId);
    if (!currentStatus) {
      return false;
    }
    if (currentStatus === EChatbotStatus.blocked) {
      return true;
    }

    const blocked = await this.executeBlockCas(
      accountId,
      'chatbot',
      enforceCurrentLimit,
      async (transaction) => {
        const updated = await transaction
          .update(chatbot)
          .set({ status: EChatbotStatus.blocked, updated_at: currentTime() })
          .where(
            and(
              eq(chatbot.account_id, accountId),
              eq(chatbot.chatbot_id, chatbotId),
              eq(chatbot.status, currentStatus)
            )
          )
          .execute();
        return updated.rowCount === 1;
      }
    );

    if (blocked) {
      this.logBlock(accountId, 'chatbot', chatbotId, enforceCurrentLimit);
    }

    return blocked;
  }

  private async blockRoleUnlocked(
    accountId: string,
    roleId: string,
    enforceCurrentLimit = false
  ): Promise<boolean> {
    if (SYSTEM_ROLE_IDS.includes(roleId as EPermissionRole)) {
      return false;
    }

    const currentStatus = await this.getRoleStatus(accountId, roleId);
    if (!currentStatus) {
      return false;
    }
    if (currentStatus === EPermissionRoleStatus.blocked) {
      return true;
    }

    const blocked = await this.executeBlockCas(
      accountId,
      'role',
      enforceCurrentLimit,
      async (transaction) => {
        const updated = await transaction
          .update(permissionRole)
          .set({
            status: EPermissionRoleStatus.blocked,
            updated_at: currentTime(),
          })
          .where(
            and(
              eq(permissionRole.account_id, accountId),
              eq(permissionRole.permission_role_id, roleId),
              eq(permissionRole.status, currentStatus),
              isNull(permissionRole.deleted_at)
            )
          )
          .execute();
        return updated.rowCount === 1;
      }
    );

    if (!blocked) {
      return false;
    }

    this.logBlock(accountId, 'role', roleId, enforceCurrentLimit);
    const userIds = await this.listUserIdsByRole(accountId, roleId);
    await this.userSessionInvalidationService.invalidateUsers(
      accountId,
      userIds
    );

    return true;
  }

  private async blockAiAgentUnlocked(
    accountId: string,
    aiAgentId: string,
    enforceCurrentLimit = false
  ): Promise<boolean> {
    const currentStatus = await this.getAiAgentStatus(accountId, aiAgentId);
    if (!currentStatus) {
      return false;
    }
    if (currentStatus === EAiAgentStatus.inactive) {
      return true;
    }

    const blocked = await this.executeBlockCas(
      accountId,
      'ai_agent',
      enforceCurrentLimit,
      async (transaction) => {
        const updated = await transaction
          .update(aiAgent)
          .set({ status: EAiAgentStatus.inactive, updated_at: currentTime() })
          .where(
            and(
              eq(aiAgent.account_id, accountId),
              eq(aiAgent.ai_agent_id, aiAgentId),
              eq(aiAgent.status, currentStatus)
            )
          )
          .execute();
        return updated.rowCount === 1;
      }
    );

    if (blocked) {
      this.logBlock(accountId, 'ai_agent', aiAgentId, enforceCurrentLimit);
    }

    return blocked;
  }

  private async listUserBlockCandidates(
    accountId: string,
    limit: number
  ): Promise<{ user_id: string }[]> {
    return this.dbRw
      .select({ user_id: user.user_id })
      .from(user)
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at),
          sql`NOT EXISTS (
            SELECT 1
            FROM "permission_assignment" pa
            WHERE pa.user_id = ${user.user_id}
              AND pa.permission_role_id IN (
                ${EPermissionRole.master},
                ${EPermissionRole.administrator}
              )
          )`
        )
      )
      .orderBy(desc(user.created_at), desc(user.user_id))
      .limit(limit)
      .execute();
  }

  private async listWorkerBlockCandidates(
    accountId: string,
    limit: number
  ): Promise<WorkerBlockCandidate[]> {
    return this.dbRw
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        session_storage: worker.session_storage,
        worker_status_id: worker.worker_status_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        updated_at: worker.updated_at,
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, BLOCKED_WORKER_STATUSES)
        )
      )
      .orderBy(desc(worker.created_at), desc(worker.worker_id))
      .limit(limit)
      .execute();
  }

  private async listChatbotBlockCandidates(
    accountId: string,
    limit: number
  ): Promise<{ chatbot_id: string }[]> {
    return this.dbRw
      .select({ chatbot_id: chatbot.chatbot_id })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.account_id, accountId),
          eq(chatbot.status, EChatbotStatus.active)
        )
      )
      .orderBy(desc(chatbot.created_at), desc(chatbot.chatbot_id))
      .limit(limit)
      .execute();
  }

  private async listRoleBlockCandidates(
    accountId: string,
    limit: number
  ): Promise<{ permission_role_id: string }[]> {
    return this.dbRw
      .select({ permission_role_id: permissionRole.permission_role_id })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          isNull(permissionRole.deleted_at),
          notInArray(permissionRole.permission_role_id, SYSTEM_ROLE_IDS)
        )
      )
      .orderBy(
        desc(permissionRole.created_at),
        desc(permissionRole.permission_role_id)
      )
      .limit(limit)
      .execute();
  }

  private async listAiAgentBlockCandidates(
    accountId: string,
    limit: number
  ): Promise<{ ai_agent_id: string }[]> {
    return this.dbRw
      .select({ ai_agent_id: aiAgent.ai_agent_id })
      .from(aiAgent)
      .where(
        and(
          eq(aiAgent.account_id, accountId),
          eq(aiAgent.status, EAiAgentStatus.active)
        )
      )
      .orderBy(desc(aiAgent.created_at), desc(aiAgent.ai_agent_id))
      .limit(limit)
      .execute();
  }

  private async getUserStatus(
    accountId: string,
    userId: string
  ): Promise<string | null> {
    const rows = await this.dbRw
      .select({ status: user.user_status_id })
      .from(user)
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_id, userId),
          isNull(user.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.status ?? null;
  }

  private async getWorker(
    accountId: string,
    workerId: string
  ): Promise<WorkerBlockCandidate | null> {
    const rows = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        session_storage: worker.session_storage,
        worker_status_id: worker.worker_status_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        updated_at: worker.updated_at,
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows[0] ?? null;
  }

  private async getChatbotStatus(
    accountId: string,
    chatbotId: string
  ): Promise<EChatbotStatus | null> {
    const rows = await this.dbRw
      .select({ status: chatbot.status })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.account_id, accountId),
          eq(chatbot.chatbot_id, chatbotId)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.status ?? null;
  }

  private async getRoleStatus(
    accountId: string,
    roleId: string
  ): Promise<EPermissionRoleStatus | null> {
    const rows = await this.dbRw
      .select({ status: permissionRole.status })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.permission_role_id, roleId),
          isNull(permissionRole.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.status ?? null;
  }

  private async getAiAgentStatus(
    accountId: string,
    aiAgentId: string
  ): Promise<EAiAgentStatus | null> {
    const rows = await this.dbRw
      .select({ status: aiAgent.status })
      .from(aiAgent)
      .where(
        and(
          eq(aiAgent.account_id, accountId),
          eq(aiAgent.ai_agent_id, aiAgentId)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.status ?? null;
  }

  private async isProtectedUser(userId: string): Promise<boolean> {
    const result = await this.dbRw
      .select({ total: count() })
      .from(permissionAssignment)
      .where(
        and(
          eq(permissionAssignment.user_id, userId),
          inArray(permissionAssignment.permission_role_id, SYSTEM_ROLE_IDS)
        )
      )
      .execute();

    return (result[0]?.total ?? 0) > 0;
  }

  private async listUserIdsByRole(
    accountId: string,
    roleId: string
  ): Promise<string[]> {
    const rows = await this.dbRw
      .select({ user_id: user.user_id })
      .from(permissionAssignment)
      .innerJoin(user, eq(user.user_id, permissionAssignment.user_id))
      .where(
        and(
          eq(user.account_id, accountId),
          eq(permissionAssignment.permission_role_id, roleId)
        )
      )
      .execute();

    return rows
      .map((row) => row.user_id)
      .filter((userId): userId is string => Boolean(userId));
  }

  private buildWorkerCleanupMessage(
    current: WorkerBlockCandidate,
    operationId: string
  ): IWorkerLifecycleQueueMessage {
    if (!current.server_id) {
      throw new Error('Worker cleanup requires a server');
    }

    return {
      request_id: uuidv7(),
      operation_id: operationId,
      action: 'cleanup_previous_runtime',
      worker_id: current.worker_id,
      account_id: current.account_id,
      server_id: current.server_id,
      worker_type_id: current.worker_type_id as EWorkerType,
      session_storage: current.session_storage,
      worker_status_id: EWorkerStatus.blocked,
      previous_server_id: current.server_id,
      previous_worker_type_id: current.worker_type_id as EWorkerType,
      previous_worker_status_id: current.worker_status_id as EWorkerStatus,
      source: 'plan_limit_enforcement',
      remove_session: false,
      remove_volume: false,
      requested_at: currentTime(),
    };
  }

  private async publishWorkerStatus(
    current: WorkerBlockCandidate
  ): Promise<void> {
    const payload = {
      worker_id: current.worker_id,
      account_id: current.account_id,
      server_id: current.server_id ?? undefined,
      worker_type_id: current.worker_type_id,
      worker_status_id: current.worker_status_id,
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(current.account_id),
        payload
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
    ]);
  }

  private async markCheckpointStarted(accountId: string): Promise<void> {
    const now = currentTime();

    await this.dbRw
      .insert(planLimitEnforcementCheckpoint)
      .values({
        account_id: accountId,
        last_started_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: planLimitEnforcementCheckpoint.account_id,
        set: {
          last_started_at: now,
          updated_at: now,
        },
      })
      .execute();
  }

  private async markCheckpointSucceeded(accountId: string): Promise<void> {
    const now = currentTime();

    await this.dbRw
      .insert(planLimitEnforcementCheckpoint)
      .values({
        account_id: accountId,
        last_checked_at: now,
        last_finished_at: now,
        last_error: null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: planLimitEnforcementCheckpoint.account_id,
        set: {
          last_checked_at: now,
          last_finished_at: now,
          last_error: null,
          updated_at: now,
        },
      })
      .execute();
  }

  private async markCheckpointFailed(
    accountId: string,
    error: string
  ): Promise<void> {
    const now = currentTime();

    await this.dbRw
      .insert(planLimitEnforcementCheckpoint)
      .values({
        account_id: accountId,
        last_finished_at: now,
        last_error: error,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: planLimitEnforcementCheckpoint.account_id,
        set: {
          last_finished_at: now,
          last_error: error,
          updated_at: now,
        },
      })
      .execute();
  }

  private logUsage(
    message: string,
    accountId: string,
    resource: PlanLimitResource,
    usage: PlanLimitUsage,
    level: 'info' | 'warn' = 'info'
  ): void {
    console[level](message, {
      account_id: accountId,
      resource,
      allowed: usage.allowed,
      active: usage.active,
      available: usage.available,
      excess: Math.max(usage.active - usage.allowed, 0),
      plan_is_active: usage.planIsActive,
    });
  }

  private logBlock(
    accountId: string,
    resource: PlanLimitResource,
    targetId: string,
    automatic: boolean
  ): void {
    console.info('Plan limit resource status changed', {
      source: automatic ? 'plan_limit_enforcement' : 'manual',
      account_id: accountId,
      resource,
      target_id: targetId,
    });
  }

  private ensureNotSystemRole(
    t: TFunction<'translation', undefined>,
    roleId: string
  ): void {
    if (SYSTEM_ROLE_IDS.includes(roleId as EPermissionRole)) {
      throw new Error(t('cannot_block_system_role'));
    }
  }

  private formatLimitError(
    t: TFunction<'translation', undefined>,
    resource: PlanLimitResource,
    usage: PlanLimitUsage
  ): string {
    return t('plan_limit_activate_exceeded', {
      resource: t(`plan_limit_resource_${resource}`),
      limit: usage.allowed,
      active: usage.active,
      available: usage.available,
    });
  }
}
