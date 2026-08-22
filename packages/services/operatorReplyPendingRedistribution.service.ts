import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { v5 as uuidv5 } from 'uuid';
import { ChatService } from './chat.service';
import { WorkerConfigService } from './workerConfig.service';
import { UserService } from './user.service';
import { PresenceService } from './presence.service';
import { SectorService } from './sector.service';
import { ChatMessageService } from './chatMessage.service';
import { CentrifugoService } from './centrifugo.service';
import { PushNotificationService } from './pushNotification.service';
import { OperatorReplyPendingRedistributionTrackerService } from './operatorReplyPendingRedistributionTracker.service';
import { IOperatorReplyPendingRedistributionData } from '@core/common/interfaces/IOperatorReplyPendingRedistributionData';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { withLock } from '@core/common/functions/withLock';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { OperatorReplyPendingRedistributionCandidateRepository } from '@core/repositories/user/OperatorReplyPendingRedistributionCandidate.repository';
import { isOperatorReplyPendingRedistributionSectorInScope } from '@core/common/functions/operatorReplyPendingRedistributionConfig';

const REDISTRIBUTION_UUID_NAMESPACE = '019f9c22-9857-724f-921b-06d3eca98337';

@injectable()
export class OperatorReplyPendingRedistributionService {
  private readonly retryBaseMs = 30_000;
  private readonly retryMaxMs = 300_000;
  private reconciled = false;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(OperatorReplyPendingRedistributionTrackerService)
    private readonly tracker: OperatorReplyPendingRedistributionTrackerService,
    @inject(ChatService) private readonly chatService: ChatService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(UserService) private readonly userService: UserService,
    @inject(PresenceService)
    private readonly presenceService: PresenceService,
    @inject(OperatorReplyPendingRedistributionCandidateRepository)
    private readonly candidateRepository: OperatorReplyPendingRedistributionCandidateRepository,
    @inject(SectorService) private readonly sectorService: SectorService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(PushNotificationService)
    private readonly pushNotificationService: PushNotificationService
  ) {}

  private cursorKey(
    data: IOperatorReplyPendingRedistributionData,
    sectorId: string
  ) {
    return `underchat:operator-reply-pending-redistribution-cursor:${data.account_id}:${data.worker_id}:${sectorId}`;
  }

  private poolLockKey(
    data: IOperatorReplyPendingRedistributionData,
    sectorId: string
  ) {
    return `operator-reply-pending-redistribution-pool:${data.account_id}:${data.worker_id}:${sectorId}`;
  }

  private chatLockKey(data: IOperatorReplyPendingRedistributionData) {
    return `operator-reply-pending-redistribution-chat:${data.account_id}:${data.worker_id}:${data.chat_id}`;
  }

  private retryDelay(retryCount: number): number {
    return Math.min(
      this.retryMaxMs,
      this.retryBaseMs * 2 ** Math.min(retryCount, 4)
    );
  }

  private async configuredDelay(workerId: string): Promise<{
    enabled: boolean;
    delayMs: number;
    sectorIds: string[];
  }> {
    const config =
      await this.workerConfigService.viewOperatorReplyPendingRedistribution(
        workerId
      );
    return {
      enabled: config.enabled,
      delayMs: config.time_minutes * 60_000,
      sectorIds: config.sector_ids,
    };
  }

  private async eligibleUsers(
    data: IOperatorReplyPendingRedistributionData,
    sectorId: string,
    currentUserId: string
  ) {
    const [activeUsers, sectorUsers, channelUserIds, simultaneous] =
      await Promise.all([
        this.candidateRepository.listActiveUsers(data.account_id),
        this.sectorService.listSectorUsersForTransfer(
          data.account_id,
          sectorId
        ),
        this.userService.listUserIdsWithAccessToChannel(
          data.account_id,
          data.worker_id
        ),
        this.workerConfigService.viewSimultaneousAttendance(data.worker_id),
      ]);
    const sectorIds = new Set(sectorUsers.map((user) => user.id));
    const channelIds = new Set(channelUserIds);
    const eligibleByMembership = activeUsers
      .filter(
        (user) =>
          user.id !== currentUserId &&
          sectorIds.has(user.id) &&
          channelIds.has(user.id)
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const presenceStatuses = await Promise.all(
      eligibleByMembership.map((candidate) =>
        this.presenceService.getStatus(candidate.id)
      )
    );
    const candidates = eligibleByMembership.filter(
      (_candidate, index) => presenceStatuses[index] === EChatUserStatus.online
    );

    if (!simultaneous.enabled || !simultaneous.simultaneous_attendance) {
      return candidates;
    }

    const counts = await Promise.all(
      candidates.map((candidate) =>
        this.chatService.countInChatChatsByUserId(
          data.account_id,
          data.worker_id,
          candidate.id
        )
      )
    );
    return candidates.filter(
      (_candidate, index) =>
        counts[index] < (simultaneous.simultaneous_attendance as number)
    );
  }

  private async completeEffects(
    key: string,
    data: IOperatorReplyPendingRedistributionData,
    chat: NonNullable<Awaited<ReturnType<ChatService['findChatByChatId']>>>
  ): Promise<IOperatorReplyPendingRedistributionData> {
    const previousUser = data.previous_user;
    const targetUser = data.target_user;
    if (!previousUser || !targetUser || !data.transfer_event_id) {
      throw new Error('redistribution effects payload is incomplete');
    }

    let progress = data;
    if (!progress.effects_completed?.realtime) {
      const payload = {
        ...chat,
        notification_event: {
          type: 'chat_transfer',
          actor_user_id: null,
          source: 'operator_reply_pending_redistribution',
        },
      };
      await Promise.all([
        this.centrifugoService.publishSub(
          chatAccountCentrifugo(data.account_id),
          payload
        ),
        this.centrifugoService.publishSub(
          chatQueueAccountCentrifugo(data.account_id),
          payload
        ),
      ]);
      progress = {
        ...progress,
        effects_completed: {
          ...progress.effects_completed,
          realtime: true,
        },
      };
      await this.tracker.save(key, progress, Date.now());
    }

    if (!progress.effects_completed?.notification) {
      await this.pushNotificationService.sendNotificationForChatTransfer({
        chat,
        actorUserId: previousUser.id,
        candidateUserIds: [targetUser.id],
        targetUserName: targetUser.name,
        targetSectorName: chat.sector?.name ?? null,
        targetWorkerName: chat.worker.name,
      });
      progress = {
        ...progress,
        effects_completed: {
          ...progress.effects_completed,
          notification: true,
        },
      };
      await this.tracker.save(key, progress, Date.now());
    }

    if (!progress.effects_completed?.annotation) {
      const t = await createI18nInstance('pt');
      await this.chatMessageService.sendMessage(t, {
        chat,
        accountId: data.account_id,
        type: EMessageType.annotation,
        typeUser: ETypeUserChat.system,
        message: `Atendimento redistribuído automaticamente por falta de resposta: ${previousUser.name} → ${targetUser.name}.`,
        messageId: uuidv5(
          `${data.transfer_event_id}:annotation`,
          REDISTRIBUTION_UUID_NAMESPACE
        ),
      });
      progress = {
        ...progress,
        effects_completed: {
          ...progress.effects_completed,
          annotation: true,
        },
      };
      await this.tracker.save(key, progress, Date.now());
    }

    return progress;
  }

  private async reschedule(
    key: string,
    data: IOperatorReplyPendingRedistributionData,
    delayMs: number,
    technicalFailure = false
  ) {
    await this.tracker.save(
      key,
      {
        ...data,
        stage: technicalFailure ? data.stage : 'waiting',
        retry_count: technicalFailure ? data.retry_count + 1 : 0,
      },
      Date.now() + delayMs
    );
  }

  private async processTracked(
    key: string,
    data: IOperatorReplyPendingRedistributionData
  ): Promise<void> {
    const config = await this.configuredDelay(data.worker_id);
    if (!config.enabled) {
      await this.tracker.remove(key);
      return;
    }

    let chat = await this.chatService.findChatByChatId(
      data.account_id,
      data.chat_id
    );
    if (
      !chat ||
      !chat.summary?.operator_reply_pending_since ||
      chat.worker.id !== data.worker_id
    ) {
      await this.tracker.remove(key);
      return;
    }

    if (
      !isOperatorReplyPendingRedistributionSectorInScope(
        { sector_ids: config.sectorIds },
        chat.sector?.id
      )
    ) {
      await this.tracker.remove(key);
      return;
    }

    if (
      data.stage === 'transferring' &&
      data.transfer_event_id &&
      data.target_user &&
      chat.meta?.assignment_event_id === data.transfer_event_id &&
      chat.user?.id === data.target_user.id
    ) {
      const recoveredTargetUserId = data.target_user.id;
      data = { ...data, stage: 'effects_pending' };
      await this.tracker.save(key, data, Date.now());
      if (chat.sector?.id) {
        await this.redis.set(
          this.cursorKey(data, chat.sector.id),
          recoveredTargetUserId
        );
      }
    }

    if (data.stage === 'effects_pending') {
      if (
        chat.meta?.assignment_event_id !== data.transfer_event_id ||
        !data.target_user ||
        chat.user?.id !== data.target_user.id
      ) {
        await this.tracker.remove(key);
        return;
      }
      const completedData = await this.completeEffects(key, data, chat);
      const currentAfterEffects = await this.chatService.findChatByChatId(
        data.account_id,
        data.chat_id
      );
      if (!currentAfterEffects?.summary?.operator_reply_pending_since) {
        await this.tracker.remove(key);
        return;
      }
      await this.tracker.save(
        key,
        {
          ...completedData,
          stage: 'waiting',
          retry_count: 0,
          redistribution_count: data.redistribution_count + 1,
          expected_primary_user_id: chat.user.id,
          expected_assignment_event_id: chat.meta?.assignment_event_id ?? null,
          expected_assignment_epoch: chat.meta?.assignment_epoch ?? null,
          expected_status_event_id: chat.meta?.status_event_id ?? null,
          expected_status_epoch: chat.meta?.status_epoch ?? null,
          expected_last_message_id: chat.summary?.last_message_id ?? null,
          expected_summary_revision: chat.summary?.revision ?? 0,
          transfer_event_id: null,
          previous_user: null,
          target_user: null,
          effects_completed: undefined,
        },
        Date.now() + config.delayMs
      );
      return;
    }

    if (chat.status !== EChatStatus.in_chat || !chat.user?.id) {
      await this.reschedule(key, data, config.delayMs);
      return;
    }

    if (chat.summary.operator_reply_pending_since !== data.pending_since) {
      await this.tracker.save(
        key,
        {
          ...data,
          pending_since: chat.summary.operator_reply_pending_since,
          expected_primary_user_id: chat.user.id,
          expected_assignment_event_id: chat.meta?.assignment_event_id ?? null,
          expected_assignment_epoch: chat.meta?.assignment_epoch ?? null,
          expected_status_event_id: chat.meta?.status_event_id ?? null,
          expected_status_epoch: chat.meta?.status_epoch ?? null,
          expected_last_message_id: chat.summary.last_message_id ?? null,
          expected_summary_revision: chat.summary.revision ?? 0,
          retry_count: 0,
          stage: 'waiting',
        },
        Date.now() + config.delayMs
      );
      return;
    }

    if (
      chat.user.id !== data.expected_primary_user_id ||
      (chat.meta?.assignment_event_id ?? null) !==
        data.expected_assignment_event_id ||
      (chat.meta?.assignment_epoch ?? null) !== data.expected_assignment_epoch
    ) {
      await this.tracker.save(
        key,
        {
          ...data,
          expected_primary_user_id: chat.user.id,
          expected_assignment_event_id: chat.meta?.assignment_event_id ?? null,
          expected_assignment_epoch: chat.meta?.assignment_epoch ?? null,
          expected_status_event_id: chat.meta?.status_event_id ?? null,
          expected_status_epoch: chat.meta?.status_epoch ?? null,
          expected_last_message_id: chat.summary?.last_message_id ?? null,
          expected_summary_revision: chat.summary?.revision ?? 0,
          retry_count: 0,
          stage: 'waiting',
        },
        Date.now() + config.delayMs
      );
      return;
    }

    if (!chat.sector?.id) {
      await this.reschedule(key, data, config.delayMs);
      return;
    }

    const sectorId = chat.sector.id;
    const currentChat = chat;
    const currentUser = chat.user;
    await withLock(
      this.redis,
      this.poolLockKey(data, sectorId),
      async () => {
        const candidates = await this.eligibleUsers(
          data,
          sectorId,
          currentUser.id
        );
        if (candidates.length === 0) {
          await this.reschedule(key, data, config.delayMs);
          return;
        }

        const cursorKey = this.cursorKey(data, sectorId);
        const cursor = await this.redis.get(cursorKey);
        const cursorIndex = cursor
          ? candidates.findIndex((candidate) => candidate.id === cursor)
          : -1;
        const target = candidates[(cursorIndex + 1) % candidates.length];
        const transferEventId = uuidv5(
          `${data.tracking_id}:${data.redistribution_count + 1}`,
          REDISTRIBUTION_UUID_NAMESPACE
        );
        const transferring: IOperatorReplyPendingRedistributionData = {
          ...data,
          stage: 'transferring',
          expected_status_event_id: currentChat.meta?.status_event_id ?? null,
          expected_status_epoch: currentChat.meta?.status_epoch ?? null,
          expected_last_message_id:
            currentChat.summary?.last_message_id ?? null,
          expected_summary_revision: currentChat.summary?.revision ?? 0,
          transfer_event_id: transferEventId,
          previous_user: currentUser,
          target_user: { ...target, entered_at: new Date().toISOString() },
          effects_completed: {},
        };
        await this.tracker.save(key, transferring, Date.now());

        const result = await this.chatService.reassignPendingOperatorReply({
          accountId: data.account_id,
          chat: currentChat,
          nextUser: target,
          eventId: transferEventId,
          eventEpochMillis: Date.now(),
          expectedPrimaryUserId: data.expected_primary_user_id,
          expectedAssignmentEventId: data.expected_assignment_event_id,
          expectedAssignmentEpoch: data.expected_assignment_epoch,
          expectedStatusEventId: transferring.expected_status_event_id,
          expectedStatusEpoch: transferring.expected_status_epoch,
          expectedLastMessageId: transferring.expected_last_message_id,
          expectedSummaryRevision: transferring.expected_summary_revision,
          expectedPendingSince: data.pending_since,
        });
        if (!result.applied || !result.chat?.user) {
          const latest = await this.tracker.get(key);
          if (
            !latest ||
            latest.stage !== 'transferring' ||
            latest.transfer_event_id !== transferEventId
          ) {
            return;
          }
          await this.reschedule(key, data, config.delayMs);
          return;
        }

        chat = result.chat;
        const effectsPending = {
          ...transferring,
          stage: 'effects_pending' as const,
        };
        await this.tracker.save(key, effectsPending, Date.now());
        await this.redis.set(cursorKey, target.id);
        const completedEffects = await this.completeEffects(
          key,
          effectsPending,
          result.chat
        );
        const currentAfterEffects = await this.chatService.findChatByChatId(
          data.account_id,
          data.chat_id
        );
        if (!currentAfterEffects?.summary?.operator_reply_pending_since) {
          await this.tracker.remove(key);
          return;
        }
        await this.tracker.save(
          key,
          {
            ...completedEffects,
            stage: 'waiting',
            redistribution_count: data.redistribution_count + 1,
            retry_count: 0,
            expected_primary_user_id: result.chat.user.id,
            expected_assignment_event_id:
              result.chat.meta?.assignment_event_id ?? null,
            expected_assignment_epoch:
              result.chat.meta?.assignment_epoch ?? null,
            expected_status_event_id: result.chat.meta?.status_event_id ?? null,
            expected_status_epoch: result.chat.meta?.status_epoch ?? null,
            expected_last_message_id:
              result.chat.summary?.last_message_id ?? null,
            expected_summary_revision: result.chat.summary?.revision ?? 0,
            transfer_event_id: null,
            previous_user: null,
            target_user: null,
            effects_completed: undefined,
          },
          Date.now() + config.delayMs
        );
      },
      { ttlMs: 60_000, maxWaitMs: 2_000, retryMs: 100 }
    );
  }

  async processScheduledRedistributions(): Promise<void> {
    if (!this.reconciled) {
      await this.tracker.reconcile();
      this.reconciled = true;
    }
    const keys = await this.tracker.listDue(Date.now(), 100);
    for (const key of keys) {
      const data = await this.tracker.get(key);
      if (!data) {
        await this.tracker.remove(key);
        continue;
      }
      try {
        await withLock(
          this.redis,
          this.chatLockKey(data),
          () => this.processTracked(key, data),
          { ttlMs: 60_000, maxWaitMs: 500, retryMs: 75 }
        );
      } catch {
        const latest = (await this.tracker.get(key)) ?? data;
        await this.reschedule(
          key,
          latest,
          this.retryDelay(latest.retry_count),
          true
        ).catch(() => undefined);
      }
    }
  }
}
