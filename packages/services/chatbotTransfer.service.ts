import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import Redis from 'ioredis';
import { ChatService } from './chat.service';
import { WorkerService } from './worker.service';
import { CentrifugoService } from './centrifugo.service';
import { OperatorReplyPendingRedistributionTrackerService } from './operatorReplyPendingRedistributionTracker.service';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { isChatbotStatus } from '@core/common/functions/chatStatus';
import { withLock } from '@core/common/functions/withLock';
import { buildChatIdentityLockKey } from '@core/common/functions/chatIdentity';
import { createChatCacheKey } from '@core/common/functions/createCacheKey';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import type { OutboundWebhookActor } from '@core/common/functions/outboundWebhookPayload';

export interface ChatbotTransferTarget {
  worker: IChat['worker'];
  chatbotId: string;
  status: EChatStatus.ura | EChatStatus.ura_output;
  chatbotTransferId: string | null;
}

export interface ChatbotTransferResult {
  chat: IChat;
  target: ChatbotTransferTarget;
  transitioned: boolean;
  concurrentActivity: boolean;
}

export interface ChatbotTransferInput {
  t: TFunction<'translation', undefined>;
  accountId: string;
  chat: IChat;
  targetWorkerId: string;
  targetChatbotId: string;
  operationId: string;
  eventEpochMillis: number;
  source: string;
  actor: OutboundWebhookActor;
  expectedLastMessageId?: string | null;
  expectedSummaryRevision?: number;
}

@injectable()
export class ChatbotTransferService {
  constructor(
    @inject(ChatService) private readonly chatService: ChatService,
    @inject(WorkerService) private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis,
    @inject(OperatorReplyPendingRedistributionTrackerService)
    private readonly operatorReplyPendingRedistributionTracker: OperatorReplyPendingRedistributionTrackerService
  ) {}

  async resolveTarget(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    chatbotId: string
  ): Promise<ChatbotTransferTarget> {
    const worker = await this.workerService.viewWorkerNameAndId(
      accountId,
      workerId
    );
    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    const config = await this.chatService.viewWorkerConfigForChat(workerId);
    if (config?.input_chatbot?.chatbot_id === chatbotId) {
      return {
        worker: { id: worker.id, name: worker.name },
        chatbotId,
        status: EChatStatus.ura,
        chatbotTransferId: chatbotId,
      };
    }
    if (config?.output_chatbot?.chatbot_id === chatbotId) {
      return {
        worker: { id: worker.id, name: worker.name },
        chatbotId,
        status: EChatStatus.ura_output,
        chatbotTransferId: null,
      };
    }

    throw new Error(t('chatbot_not_found'));
  }

  async transfer(input: ChatbotTransferInput): Promise<ChatbotTransferResult> {
    const target = await this.resolveTarget(
      input.t,
      input.accountId,
      input.targetWorkerId,
      input.targetChatbotId
    );

    return this.withTargetIdentityGuard(input, target, () =>
      this.applyTransition(input, target)
    );
  }

  private async withTargetIdentityGuard<T>(
    input: ChatbotTransferInput,
    target: ChatbotTransferTarget,
    operation: () => Promise<T>
  ): Promise<T> {
    if (target.worker.id === input.chat.worker.id) {
      return operation();
    }

    const identity = {
      phone: input.chat.phone,
      remoteJid: input.chat.message_key?.remote_jid,
      remoteJidAlt: input.chat.message_key?.remote_jid_alt,
    };
    const lockKey = buildChatIdentityLockKey(
      input.accountId,
      target.worker.id,
      identity
    );

    return withLock(
      this.redis,
      lockKey,
      async (lockContext) => {
        const existing = await this.chatService.findOpenChatByIdentity(
          input.accountId,
          target.worker.id,
          identity
        );
        lockContext.assertActive();
        if (existing && existing.chat_id !== input.chat.chat_id) {
          if (existing.sector?.name) {
            throw new Error(
              input.t('chat_already_in_service_with_sector', {
                sector: existing.sector.name,
              })
            );
          }
          throw new Error(input.t('chat_already_in_service'));
        }

        const result = await operation();
        lockContext.assertActive();
        return result;
      },
      { ttlMs: 60_000, retryMs: 100, maxWaitMs: 90_000 }
    );
  }

  private async applyTransition(
    input: ChatbotTransferInput,
    target: ChatbotTransferTarget
  ): Promise<ChatbotTransferResult> {
    const currentChat =
      (await this.chatService.findChatByChatId(
        input.accountId,
        input.chat.chat_id
      )) ?? input.chat;
    const alreadyApplied =
      currentChat.meta?.assignment_event_id === input.operationId &&
      currentChat.worker.id === target.worker.id &&
      currentChat.status === target.status;

    const expectedLastMessageId =
      input.expectedLastMessageId !== undefined
        ? input.expectedLastMessageId
        : (currentChat.summary?.last_message_id ?? null);
    const expectedSummaryRevision =
      input.expectedSummaryRevision ?? currentChat.summary?.revision ?? 0;

    if (
      !alreadyApplied &&
      ((input.expectedLastMessageId !== undefined &&
        (currentChat.summary?.last_message_id ?? null) !==
          input.expectedLastMessageId) ||
        (input.expectedSummaryRevision !== undefined &&
          (currentChat.summary?.revision ?? 0) !==
            input.expectedSummaryRevision))
    ) {
      throw new Error(input.t('chat_transfer_failed'));
    }

    if (!alreadyApplied) {
      const applied = await this.chatService.applyChatPatch(
        currentChat.chat_id,
        {
          worker: target.worker,
          status: target.status,
          user: null,
          secondary_users: [],
          sector: null,
          forward_to_output_chatbot: false,
          chatbot_transfer_id: target.chatbotTransferId,
          chatbot_schedule_id: null,
          chatbot_webhook_id: null,
        },
        {
          eventEpochMillis: input.eventEpochMillis,
          eventId: input.operationId,
          statusSource: input.source,
          refresh: true,
          expectedCurrentStatuses: [currentChat.status],
          enforceExpectedStatusRevision: true,
          expectedStatusEventId: currentChat.meta?.status_event_id ?? null,
          expectedStatusEpoch: currentChat.meta?.status_epoch ?? null,
          enforceAssignmentRevision: true,
          enforceExpectedLastMessageId: true,
          expectedLastMessageId: currentChat.summary?.last_message_id ?? null,
          enforceExpectedSummaryRevision: true,
          expectedSummaryRevision: currentChat.summary?.revision ?? 0,
          allowHumanToAutomation: true,
          outboundWebhook: {
            eventTypes: [
              'chat.transferred',
              ...(isChatbotStatus(currentChat.status)
                ? []
                : (['chat.automation.started'] as const)),
            ],
            idempotencyKey: input.operationId,
            source: input.source,
            previousChat: currentChat,
            actor: input.actor,
            changes: {
              target_type: 'automation',
              target_chatbot_id: target.chatbotId,
              target_worker_id: target.worker.id,
              previous_status: currentChat.status,
              status: target.status,
            },
          },
        }
      );
      if (!applied) {
        throw new Error(input.t('chat_transfer_failed'));
      }
    }

    const transitionedChat = await this.chatService.findChatByChatId(
      input.accountId,
      currentChat.chat_id
    );
    if (!transitionedChat) {
      throw new Error(input.t('chat_not_found'));
    }

    const summaryCleared = await this.chatService.clearChatSummary(
      transitionedChat.chat_id,
      input.accountId,
      {
        operationId: `${input.operationId}:summary`,
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId,
      }
    );
    const persistedChat =
      (await this.chatService.findChatByChatId(
        input.accountId,
        currentChat.chat_id
      )) ?? transitionedChat;
    const concurrentActivity =
      (persistedChat.summary?.last_message_id ?? null) !==
      expectedLastMessageId;
    if (!summaryCleared && !concurrentActivity) {
      throw new Error(input.t('chat_transfer_failed'));
    }
    await this.invalidateCaches(input.accountId, currentChat, persistedChat);
    if (!alreadyApplied) {
      await this.operatorReplyPendingRedistributionTracker.handleChatTransition(
        persistedChat
      );
      await this.publishTransition(persistedChat, input.actor.id ?? null);
    }

    return {
      chat: persistedChat,
      target,
      transitioned: !alreadyApplied,
      concurrentActivity,
    };
  }

  private async invalidateCaches(
    accountId: string,
    previousChat: IChat,
    updatedChat: IChat
  ): Promise<void> {
    const cacheAccountId =
      updatedChat.account?.id ?? previousChat.account?.id ?? accountId;
    await this.redis.del(
      createChatCacheKey(
        cacheAccountId,
        previousChat.worker.id,
        previousChat.phone
      )
    );
    await this.chatService.invalidateChatCache(updatedChat);
  }

  private async publishTransition(
    chat: IChat,
    actorUserId: string | null
  ): Promise<void> {
    const payload = {
      ...chat,
      notification_event: {
        type: 'chat_transfer',
        actor_user_id: actorUserId,
      },
    };
    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(chat.account.id),
        payload
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(chat.account.id),
        payload
      ),
    ]);
  }
}
