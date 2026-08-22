import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { WorkerConfigService } from './workerConfig.service';
import { IOperatorReplyPendingRedistributionData } from '@core/common/interfaces/IOperatorReplyPendingRedistributionData';
import { isOperatorReplyPendingRedistributionSectorInScope } from '@core/common/functions/operatorReplyPendingRedistributionConfig';

@injectable()
export class OperatorReplyPendingRedistributionTrackerService {
  static readonly SCHEDULE_KEY =
    'underchat:operator-reply-pending-redistribution-schedule';
  private static readonly PAYLOAD_PREFIX =
    'underchat:operator-reply-pending-redistribution';

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService
  ) {}

  payloadKey(accountId: string, workerId: string, chatId: string): string {
    return `${OperatorReplyPendingRedistributionTrackerService.PAYLOAD_PREFIX}:${accountId}:${workerId}:${chatId}`;
  }

  private parse(
    raw: string | null
  ): IOperatorReplyPendingRedistributionData | null {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as IOperatorReplyPendingRedistributionData;
      if (
        !data.account_id ||
        !data.worker_id ||
        !data.chat_id ||
        !data.tracking_id ||
        !data.pending_since ||
        !data.expected_primary_user_id
      ) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async scheduleForNewContactMessage(chat: IChat): Promise<boolean> {
    const pendingSince = chat.summary?.operator_reply_pending_since;
    if (
      chat.status !== EChatStatus.in_chat ||
      !chat.user?.id ||
      !pendingSince
    ) {
      return false;
    }

    const config =
      await this.workerConfigService.viewOperatorReplyPendingRedistribution(
        chat.worker.id
      );
    if (
      !config.enabled ||
      !isOperatorReplyPendingRedistributionSectorInScope(
        config,
        chat.sector?.id
      )
    ) {
      return false;
    }

    const pendingEpoch = new Date(pendingSince).getTime();
    if (!Number.isFinite(pendingEpoch)) return false;

    const key = this.payloadKey(chat.account.id, chat.worker.id, chat.chat_id);
    const data: IOperatorReplyPendingRedistributionData = {
      account_id: chat.account.id,
      worker_id: chat.worker.id,
      chat_id: chat.chat_id,
      tracking_id: uuidv7(),
      pending_since: pendingSince,
      redistribution_count: 0,
      retry_count: 0,
      stage: 'waiting',
      expected_primary_user_id: chat.user.id,
      expected_assignment_event_id: chat.meta?.assignment_event_id ?? null,
      expected_assignment_epoch: chat.meta?.assignment_epoch ?? null,
      expected_status_event_id: chat.meta?.status_event_id ?? null,
      expected_status_epoch: chat.meta?.status_epoch ?? null,
      expected_last_message_id: chat.summary?.last_message_id ?? null,
      expected_summary_revision: chat.summary?.revision ?? 0,
    };
    const dueAt = pendingEpoch + config.time_minutes * 60_000;

    const result = await this.redis.eval(
      `
        if redis.call('EXISTS', KEYS[1]) == 1 then
          return 0
        end
        redis.call('SET', KEYS[1], ARGV[1])
        redis.call('ZADD', KEYS[2], ARGV[2], KEYS[1])
        return 1
      `,
      2,
      key,
      OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
      JSON.stringify(data),
      dueAt.toString()
    );

    return Number(result) === 1;
  }

  async cancel(chat: Pick<IChat, 'account' | 'worker' | 'chat_id'>) {
    return this.remove(
      this.payloadKey(chat.account.id, chat.worker.id, chat.chat_id)
    );
  }

  async handleChatTransition(chat: IChat): Promise<void> {
    const key = this.payloadKey(chat.account.id, chat.worker.id, chat.chat_id);
    const current = await this.get(key);
    if (!current) return;

    if (
      !chat.summary?.operator_reply_pending_since ||
      (chat.status !== EChatStatus.in_chat && chat.status !== EChatStatus.queue)
    ) {
      await this.remove(key);
      return;
    }

    const config =
      await this.workerConfigService.viewOperatorReplyPendingRedistribution(
        chat.worker.id
      );
    if (
      !config.enabled ||
      !isOperatorReplyPendingRedistributionSectorInScope(
        config,
        chat.sector?.id
      )
    ) {
      await this.remove(key);
      return;
    }

    const primaryUserId = chat.user?.id ?? current.expected_primary_user_id;
    await this.save(
      key,
      {
        ...current,
        pending_since: chat.summary.operator_reply_pending_since,
        stage: 'waiting',
        retry_count: 0,
        expected_primary_user_id: primaryUserId,
        expected_assignment_event_id: chat.meta?.assignment_event_id ?? null,
        expected_assignment_epoch: chat.meta?.assignment_epoch ?? null,
        expected_status_event_id: chat.meta?.status_event_id ?? null,
        expected_status_epoch: chat.meta?.status_epoch ?? null,
        expected_last_message_id: chat.summary.last_message_id ?? null,
        expected_summary_revision: chat.summary.revision ?? 0,
        transfer_event_id: null,
        previous_user: null,
        target_user: null,
        effects_completed: undefined,
      },
      Date.now() + config.time_minutes * 60_000
    );
  }

  async get(
    key: string
  ): Promise<IOperatorReplyPendingRedistributionData | null> {
    return this.parse(await this.redis.get(key));
  }

  async save(
    key: string,
    data: IOperatorReplyPendingRedistributionData,
    dueAt: number
  ): Promise<void> {
    const result = await this.redis
      .multi()
      .set(key, JSON.stringify(data))
      .zadd(
        OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
        dueAt,
        key
      )
      .exec();
    if (!result || result.some(([error]) => error !== null)) {
      throw new Error(
        'operator reply pending redistribution Redis write failed'
      );
    }
  }

  async remove(key: string): Promise<void> {
    await this.redis
      .multi()
      .del(key)
      .zrem(OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY, key)
      .exec();
  }

  async listDue(now = Date.now(), limit = 100): Promise<string[]> {
    return this.redis.zrangebyscore(
      OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
      '-inf',
      now,
      'LIMIT',
      0,
      limit
    );
  }

  async reconcile(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${OperatorReplyPendingRedistributionTrackerService.PAYLOAD_PREFIX}:*`,
        'COUNT',
        250
      );
      cursor = next;
      for (const key of keys) {
        const score = await this.redis.zscore(
          OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
          key
        );
        if (score !== null) continue;
        const data = await this.get(key);
        if (!data) {
          await this.redis.del(key);
          continue;
        }
        await this.redis.zadd(
          OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
          Date.now(),
          key
        );
      }
    } while (cursor !== '0');

    const scheduled = await this.redis.zrange(
      OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
      0,
      -1
    );
    for (const key of scheduled) {
      if ((await this.redis.exists(key)) === 0) {
        await this.redis.zrem(
          OperatorReplyPendingRedistributionTrackerService.SCHEDULE_KEY,
          key
        );
      }
    }
  }
}
