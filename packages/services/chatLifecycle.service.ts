import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IChat } from '@core/common/interfaces/IChat';
import { withLock } from '@core/common/functions/withLock';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { ChatService } from './chat.service';
import { WorkerConfigService } from './workerConfig.service';
import { ChatUserService } from './chatUser.service';
import { CentrifugoService } from './centrifugo.service';
import { resolveChatLifecycleEventTypes } from '@core/common/constants/outboundWebhookEvents';

export type ChatLifecycleSource =
  'attendance_inactivity' | 'chatbot' | 'outside_hours';

export type ChatLifecycleOutcome =
  'applied' | 'already_at_target' | 'status_mismatch' | 'retryable_failure';

export type ChatLifecycleTargetStatus =
  EChatStatus.closed | EChatStatus.ura_output;

export interface FinishChatInput {
  chat: IChat;
  source: ChatLifecycleSource;
  expectedStatuses: EChatStatus[];
  respectOutputChatbot: boolean;
  statusEventId?: string;
}

export interface FinishChatResult {
  outcome: ChatLifecycleOutcome;
  targetStatus: ChatLifecycleTargetStatus;
  chat: IChat;
  statusEventId: string;
  ownedBySource: boolean;
}

@injectable()
export class ChatLifecycleService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(ChatService) private readonly chatService: ChatService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(ChatUserService)
    private readonly chatUserService: ChatUserService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async finishChat(input: FinishChatInput): Promise<FinishChatResult> {
    const lockKey = `chat-lifecycle:${input.chat.account.id}:${input.chat.chat_id}`;

    try {
      return await withLock(
        this.redis,
        lockKey,
        () => this.finishChatWithLock(input),
        {
          ttlMs: 30000,
          maxWaitMs: 60000,
          retryMs: 120,
        }
      );
    } catch (error) {
      const result = this.buildResult({
        outcome: 'retryable_failure',
        targetStatus: this.fallbackTargetStatus(input),
        chat: input.chat,
        source: input.source,
        statusEventId: input.statusEventId,
      });

      this.logResult(input, result, error);
      return result;
    }
  }

  private async finishChatWithLock(
    input: FinishChatInput
  ): Promise<FinishChatResult> {
    const currentChat = await this.chatService.findChatByChatId(
      input.chat.account.id,
      input.chat.chat_id
    );

    if (!currentChat) {
      const result = this.buildResult({
        outcome: 'retryable_failure',
        targetStatus: this.fallbackTargetStatus(input),
        chat: input.chat,
        source: input.source,
        statusEventId: input.statusEventId,
      });
      this.logResult(input, result);
      return result;
    }

    const targetStatus = await this.resolveTargetStatus(
      currentChat,
      input.respectOutputChatbot
    );

    if (this.isAtTarget(currentChat, targetStatus)) {
      return this.finishAlreadyAtTarget(input, currentChat, targetStatus);
    }

    if (!this.hasSameStatusRevision(input.chat, currentChat)) {
      const result = this.buildResult({
        outcome: 'status_mismatch',
        targetStatus,
        chat: currentChat,
        source: input.source,
        ownershipStatusEventId: input.statusEventId,
      });
      this.logResult(input, result);
      return result;
    }

    if (!input.expectedStatuses.includes(currentChat.status)) {
      const result = this.buildResult({
        outcome: 'status_mismatch',
        targetStatus,
        chat: currentChat,
        source: input.source,
      });
      this.logResult(input, result);
      return result;
    }

    const statusEventId = input.statusEventId ?? uuidv7();
    const eventEpochMillis = Date.now();
    const patch =
      targetStatus === EChatStatus.closed
        ? {
            status: targetStatus,
            closed_at: new Date(eventEpochMillis).toISOString(),
          }
        : {
            status: targetStatus,
            forward_to_output_chatbot: false,
          };

    let updateError: unknown;
    try {
      await this.chatService.applyChatPatch(currentChat.chat_id, patch, {
        allowCreate: false,
        refresh: true,
        expectedCurrentStatuses: [currentChat.status],
        allowHumanToAutomation: targetStatus === EChatStatus.ura_output,
        clearUnreadCount: targetStatus === EChatStatus.closed,
        enforceExpectedStatusRevision: true,
        enforceExpectedStartedAt: true,
        enforceExpectedLastMessageId: true,
        enforceExpectedSummaryRevision: true,
        expectedStatusEventId: currentChat.meta?.status_event_id ?? null,
        expectedStatusEpoch: currentChat.meta?.status_epoch ?? null,
        expectedStartedAt: currentChat.started_at ?? null,
        expectedLastMessageId: currentChat.summary?.last_message_id ?? null,
        expectedSummaryRevision: currentChat.summary?.revision ?? 0,
        eventEpochMillis,
        eventId: statusEventId,
        statusSource: input.source,
        outboundWebhook: {
          eventTypes: resolveChatLifecycleEventTypes({
            operation: 'status_changed',
            previousStatus: currentChat.status,
            currentStatus: targetStatus,
          }),
          idempotencyKey: `chat-lifecycle:${currentChat.chat_id}:${statusEventId}`,
          source: input.source,
          previousChat: currentChat,
          actor: { type: 'automation' },
          changes: {
            previous_status: currentChat.status,
            status: targetStatus,
          },
        },
      });
    } catch (error) {
      updateError = error;
    }

    let confirmedChat: IChat | null = null;
    try {
      confirmedChat = await this.chatService.findChatByChatId(
        currentChat.account.id,
        currentChat.chat_id
      );
    } catch (error) {
      const result = this.buildResult({
        outcome: 'retryable_failure',
        targetStatus,
        chat: currentChat,
        source: input.source,
        statusEventId,
      });
      this.logResult(input, result, error);
      return result;
    }

    if (!confirmedChat) {
      const result = this.buildResult({
        outcome: 'retryable_failure',
        targetStatus,
        chat: currentChat,
        source: input.source,
        statusEventId,
      });
      this.logResult(input, result, updateError);
      return result;
    }

    if (confirmedChat.status !== targetStatus) {
      const outcome: ChatLifecycleOutcome =
        !this.hasSameStatusRevision(currentChat, confirmedChat) ||
        !input.expectedStatuses.includes(confirmedChat.status)
          ? 'status_mismatch'
          : 'retryable_failure';
      const result = this.buildResult({
        outcome,
        targetStatus,
        chat: confirmedChat,
        source: input.source,
        statusEventId,
      });
      this.logResult(input, result, updateError);
      return result;
    }

    const wasAppliedByThisCall =
      confirmedChat.meta?.status_event_id === statusEventId &&
      confirmedChat.meta?.status_source === input.source;
    const outcome: ChatLifecycleOutcome = wasAppliedByThisCall
      ? 'applied'
      : 'already_at_target';
    const result = this.buildResult({
      outcome,
      targetStatus,
      chat: confirmedChat,
      source: input.source,
      statusEventId: wasAppliedByThisCall ? statusEventId : undefined,
      ownershipStatusEventId: statusEventId,
    });

    if (!result.ownedBySource) {
      this.logResult(input, result, updateError);
      return result;
    }

    return this.completeInternalEffects(input, result);
  }

  private async finishAlreadyAtTarget(
    input: FinishChatInput,
    chat: IChat,
    targetStatus: ChatLifecycleTargetStatus
  ): Promise<FinishChatResult> {
    const result = this.buildResult({
      outcome: 'already_at_target',
      targetStatus,
      chat,
      source: input.source,
      ownershipStatusEventId: input.statusEventId,
    });

    if (!result.ownedBySource) {
      this.logResult(input, result);
      return result;
    }

    return this.completeInternalEffects(input, result);
  }

  private async completeInternalEffects(
    input: FinishChatInput,
    result: FinishChatResult
  ): Promise<FinishChatResult> {
    try {
      await Promise.all([
        this.centrifugoService.publishSubImmediate(
          chatAccountCentrifugo(result.chat.account.id),
          result.chat
        ),
        this.centrifugoService.publishSubImmediate(
          chatQueueAccountCentrifugo(result.chat.account.id),
          result.chat
        ),
      ]);

      const cleanupTasks: Promise<unknown>[] = [
        this.chatService.invalidateChatCache(result.chat),
      ];

      if (result.targetStatus === EChatStatus.closed) {
        cleanupTasks.push(
          this.chatUserService.clearPinnedChatsByChatId(result.chat.chat_id)
        );
      }

      await Promise.all(cleanupTasks);

      this.logResult(input, result);
      return result;
    } catch (error) {
      const retryableResult: FinishChatResult = {
        ...result,
        outcome: 'retryable_failure',
      };
      this.logResult(input, retryableResult, error);
      return retryableResult;
    }
  }

  private async resolveTargetStatus(
    chat: IChat,
    respectOutputChatbot: boolean
  ): Promise<ChatLifecycleTargetStatus> {
    if (chat.status === EChatStatus.closed) {
      return EChatStatus.closed;
    }

    if (respectOutputChatbot && chat.status === EChatStatus.ura_output) {
      return EChatStatus.ura_output;
    }

    if (!respectOutputChatbot || chat.forward_to_output_chatbot === false) {
      return EChatStatus.closed;
    }

    const chatbotConfig = await this.workerConfigService.viewChatbots(
      chat.worker.id
    );

    return chatbotConfig.enabled && chatbotConfig.output_chatbot_id
      ? EChatStatus.ura_output
      : EChatStatus.closed;
  }

  private fallbackTargetStatus(
    input: FinishChatInput
  ): ChatLifecycleTargetStatus {
    if (
      input.respectOutputChatbot &&
      input.chat.status === EChatStatus.ura_output
    ) {
      return EChatStatus.ura_output;
    }

    return EChatStatus.closed;
  }

  private isAtTarget(
    chat: IChat,
    targetStatus: ChatLifecycleTargetStatus
  ): boolean {
    return chat.status === targetStatus;
  }

  private hasSameStatusRevision(expected: IChat, current: IChat): boolean {
    return (
      expected.status === current.status &&
      (expected.meta?.status_event_id ?? null) ===
        (current.meta?.status_event_id ?? null) &&
      (expected.meta?.status_epoch ?? null) ===
        (current.meta?.status_epoch ?? null) &&
      (expected.started_at ?? null) === (current.started_at ?? null) &&
      (expected.summary?.last_message_id ?? null) ===
        (current.summary?.last_message_id ?? null)
    );
  }

  private buildResult(input: {
    outcome: ChatLifecycleOutcome;
    targetStatus: ChatLifecycleTargetStatus;
    chat: IChat;
    source: ChatLifecycleSource;
    statusEventId?: string;
    ownershipStatusEventId?: string;
  }): FinishChatResult {
    const persistedStatusEventId = input.chat.meta?.status_event_id ?? '';
    const statusEventId = input.statusEventId ?? persistedStatusEventId;
    const ownedBySource =
      Boolean(persistedStatusEventId) &&
      input.chat.meta?.status_source === input.source &&
      (!input.ownershipStatusEventId ||
        persistedStatusEventId === input.ownershipStatusEventId);

    return {
      outcome: input.outcome,
      targetStatus: input.targetStatus,
      chat: input.chat,
      statusEventId,
      ownedBySource,
    };
  }

  private logResult(
    input: FinishChatInput,
    result: FinishChatResult,
    error?: unknown
  ): void {
    const details = {
      source: input.source,
      account_id: input.chat.account.id,
      chat_id: input.chat.chat_id,
      current_status: result.chat.status,
      target_status: result.targetStatus,
      outcome: result.outcome,
      status_event_id: result.statusEventId || null,
      owned_by_source: result.ownedBySource,
      error: error instanceof Error ? error.message : (error ?? null),
    };

    if (result.outcome === 'retryable_failure') {
      console.error(
        '[ChatLifecycleService] automatic transition failed',
        details
      );
      return;
    }

    if (result.outcome === 'status_mismatch') {
      console.warn(
        '[ChatLifecycleService] automatic transition skipped',
        details
      );
      return;
    }

    console.info(
      '[ChatLifecycleService] automatic transition completed',
      details
    );
  }
}
