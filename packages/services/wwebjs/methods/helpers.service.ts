import { injectable, inject } from 'tsyringe';
import whatsappWeb, { type Client } from '@wwebjs/whatsapp-web.js';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { createHash, webcrypto as nodeCrypto } from 'node:crypto';
import { WwebjsDeliveryConfirmationService } from './deliveryConfirmation.service';
import { TypingSimulationRuntimeService } from '@core/services/typingSimulationRuntime.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';
import {
  defaultTypingSimulationConfig,
  resolveTypingSimulationMaxDelayMs,
  typingSimulationDelayMultiplier,
} from '@core/common/functions/typingSimulationConfig';
import { extractWwebjsMessageId } from '../util/wwebjsMessageId';
import type { IProviderInvocationBoundary } from '@core/common/interfaces/IProviderInvocationBoundary';
import {
  ITypingSimulationControl,
  runTypingSimulationBestEffort,
  TypingSimulationSingleFlight,
} from '@core/common/functions/typingSimulationExecution';
import {
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import { resolveWwebjsSendMessageTimeoutMs } from '@core/services/wwebjs/util/providerSendTimeout';
import {
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';
import { downloadMediaBuffer } from '@core/common/functions/downloadMediaBuffer';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

const { MessageMedia } = whatsappWeb;

function hashWwebjsLogIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return `sha256:${createHash('sha256').update(value.trim()).digest('hex')}`;
}

class WwebjsSendMessageTimeoutError extends Error {
  readonly code = 'WWEBJS_SEND_MESSAGE_TIMEOUT';

  constructor(timeoutMs: number) {
    super(`Wwebjs sendMessage timed out after ${timeoutMs}ms`);
    this.name = 'WwebjsSendMessageTimeoutError';
  }
}

export type WwebjsProviderInvocationBoundary = IProviderInvocationBoundary;
export type WwebjsProviderLookupOperation =
  | 'edit_delete_message_lookup'
  | 'forward_destination_lookup'
  | 'quoted_message_lookup'
  | 'reaction_message_lookup';
export type WwebjsProviderMutationOperation =
  'delete_message' | 'edit_message' | 'forward_message' | 'react_message';

@injectable()
export class WwebjsHelpersService {
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;
  private readonly SEND_MESSAGE_TIMEOUT_MS =
    resolveWwebjsSendMessageTimeoutMs();
  private readonly TYPING_SIMULATION_MAX_DELAY_MS =
    resolveTypingSimulationMaxDelayMs();
  private readonly AUXILIARY_PROVIDER_TIMEOUT_MS =
    resolveProviderAuxiliaryTimeoutMs();
  private readonly typingSimulationSingleFlight =
    new TypingSimulationSingleFlight();
  private readonly providerInvocationSingleFlight =
    new ProviderInvocationSingleFlight();

  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService,
    @inject(WwebjsDeliveryConfirmationService)
    private readonly deliveryConfirmation: WwebjsDeliveryConfirmationService,
    @inject(TypingSimulationRuntimeService)
    private readonly typingSimulationRuntimeService: TypingSimulationRuntimeService
  ) {}

  getClient(): Client {
    const c = this.connection.getSocket();
    if (!c) {
      throw new Error('Wwebjs client not connected');
    }
    return c;
  }

  async sendMessage(
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2],
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<Awaited<ReturnType<Client['sendMessage']>>> {
    if (this.shouldSimulateTyping(content, options)) {
      await this.runTypingSimulationBestEffort(async (control) => {
        control.checkpoint();
        const typingConfig = await this.getTypingSimulationConfig();
        control.checkpoint();
        if (typingConfig.enabled) {
          await this.simulateHumanTyping(
            jid,
            content,
            options,
            typingConfig.speed,
            control
          );
        }
      }, beforeProviderInvoke);
    }

    return this.sendMessageWithConfirmation(
      jid,
      content,
      options,
      beforeProviderInvoke
    );
  }

  private async sendMessageWithConfirmation(
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2],
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<Awaited<ReturnType<Client['sendMessage']>>> {
    const startedAt = Date.now();
    const contentInfo = this.describeOutgoingContent(content, options);
    const optionsInfo = this.describeSendOptions(options);
    console.info('[WwebjsSend] send_start', {
      jid_hash: hashWwebjsLogIdentifier(jid),
      content: contentInfo,
      options: optionsInfo,
    });

    const client = this.getClient();
    let sentMessage: Awaited<ReturnType<Client['sendMessage']>>;
    try {
      sentMessage = await this.sendMessageRaw(
        client,
        jid,
        content,
        options,
        beforeProviderInvoke
      );
    } catch (error) {
      console.error('[WwebjsSend] send_failed_before_ack', {
        jid_hash: hashWwebjsLogIdentifier(jid),
        content: contentInfo,
        options: optionsInfo,
        duration_ms: Date.now() - startedAt,
        error: this.describeError(error),
      });
      throw error;
    }

    const sentMessageId = this.extractMessageId(sentMessage);
    if (!sentMessageId) {
      console.error('[WwebjsSend] send_failed_without_message_id', {
        jid_hash: hashWwebjsLogIdentifier(jid),
        content: contentInfo,
        options: optionsInfo,
        duration_ms: Date.now() - startedAt,
      });
      const error = new Error('Wwebjs send returned message without id');
      this.reportOutboundProtocolFailure(client, error);
      throw error;
    }
    this.connection.reportOutboundSendSuccess?.(client);

    console.info('[WwebjsSend] send_dispatched', {
      jid_hash: hashWwebjsLogIdentifier(jid),
      message_id_hash: hashWwebjsLogIdentifier(sentMessageId),
      content: contentInfo,
      options: optionsInfo,
      duration_ms: Date.now() - startedAt,
    });

    this.deliveryConfirmation.markSent(sentMessageId);
    void this.observeDeliveryConfirmation({
      jid,
      messageId: sentMessageId,
      contentInfo,
      optionsInfo,
      startedAt,
    });
    return sentMessage;
  }

  private async observeDeliveryConfirmation(input: {
    jid: string;
    messageId: string;
    contentInfo: Record<string, unknown>;
    optionsInfo: Record<string, unknown>;
    startedAt: number;
  }): Promise<void> {
    try {
      const outcome = await this.deliveryConfirmation.waitForOutcome(
        input.messageId,
        this.SEND_CONFIRMATION_TIMEOUT_MS
      );
      if (outcome === 'sent') {
        console.info('[WwebjsSend] send_ack_sent', {
          jid_hash: hashWwebjsLogIdentifier(input.jid),
          message_id_hash: hashWwebjsLogIdentifier(input.messageId),
          content: input.contentInfo,
          options: input.optionsInfo,
          duration_ms: Date.now() - input.startedAt,
        });
        return;
      }
      console.warn('[WwebjsSend] send_ack_not_confirmed', {
        jid_hash: hashWwebjsLogIdentifier(input.jid),
        message_id_hash: hashWwebjsLogIdentifier(input.messageId),
        outcome: outcome === 'failed' ? 'failed' : 'timeout',
        content: input.contentInfo,
        options: input.optionsInfo,
        duration_ms: Date.now() - input.startedAt,
      });
    } catch (error) {
      console.warn('[WwebjsSend] send_ack_observation_failed', {
        jid_hash: hashWwebjsLogIdentifier(input.jid),
        message_id_hash: hashWwebjsLogIdentifier(input.messageId),
        content: input.contentInfo,
        options: input.optionsInfo,
        duration_ms: Date.now() - input.startedAt,
        error: this.describeError(error),
      });
    }
  }

  private async sendMessageRaw(
    client: Client,
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2],
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<Awaited<ReturnType<Client['sendMessage']>>> {
    const normalizedJid = this.normalizeSendJidCandidate(jid);
    if (!normalizedJid) {
      throw new Error('Wwebjs sendMessage received empty jid');
    }

    const sendOptions = {
      ...(options ?? {}),
      waitUntilMsgSent: false,
    } as Parameters<Client['sendMessage']>[2];
    const contentInfo = this.describeOutgoingContent(content, sendOptions);
    const optionsInfo = this.describeSendOptions(sendOptions);

    console.info('[WwebjsSend] send_attempt', {
      attempt: 1,
      original_jid_hash: hashWwebjsLogIdentifier(jid),
      target_jid_hash: hashWwebjsLogIdentifier(normalizedJid),
      content: contentInfo,
      options: optionsInfo,
    });

    try {
      return await this.invokeOutboundProvider(
        client,
        normalizedJid,
        beforeProviderInvoke,
        () => client.sendMessage(normalizedJid, content, sendOptions)
      );
    } catch (error) {
      console.warn('[WwebjsSend] send_attempt_failed', {
        attempt: 1,
        original_jid_hash: hashWwebjsLogIdentifier(jid),
        target_jid_hash: hashWwebjsLogIdentifier(normalizedJid),
        content: contentInfo,
        options: optionsInfo,
        error: this.describeError(error),
      });
      console.error('[WwebjsSend] send_attempt_failed_terminal', {
        attempt: 1,
        original_jid_hash: hashWwebjsLogIdentifier(jid),
        target_jid_hash: hashWwebjsLogIdentifier(normalizedJid),
        content: contentInfo,
        options: optionsInfo,
        error: this.describeError(error),
      });
      throw error;
    }
  }

  private async invokeOutboundProvider<T>(
    client: Client,
    jid: string,
    beforeProviderInvoke: WwebjsProviderInvocationBoundary | undefined,
    invoke: () => Promise<T>
  ): Promise<T> {
    const lease = this.providerInvocationSingleFlight.acquire(client);
    if (!lease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(client);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(client);
      }
      throw new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
    }

    try {
      await beforeProviderInvoke?.();
    } catch (error) {
      lease.releaseBeforeStart();
      throw error;
    }

    try {
      beforeProviderInvoke?.assertActive?.();
      if (
        this.connection.connected === false ||
        this.connection.getSocket() !== client
      ) {
        throw new Error(
          'Wwebjs connection unavailable: provider client is no longer active'
        );
      }
    } catch (error) {
      lease.releaseBeforeStart();
      await beforeProviderInvoke?.onStartRejected?.(error);
      throw error;
    }

    let failureReported = false;
    const providerCall = lease.start(invoke);
    void providerCall.catch((error: unknown) => {
      if (!failureReported) {
        failureReported = true;
        if (
          this.connection.reportOutboundSendFailure?.(client, error) === true
        ) {
          lease.markStalled();
        }
      }
    });

    try {
      return await this.invokeProviderSendWithTimeout({
        invoke: () => providerCall,
        jid,
      });
    } catch (error) {
      if (error instanceof WwebjsSendMessageTimeoutError && !failureReported) {
        failureReported = true;
        lease.markStalled();
        this.connection.reportOutboundSendFailure?.(client, error, {
          timedOut: true,
        });
      }
      throw error;
    }
  }

  private async invokeAuxiliaryProvider<T>(
    client: Client,
    operation: string,
    beforeProviderInvoke: WwebjsProviderInvocationBoundary | undefined,
    invoke: () => Promise<T>,
    timeoutMs = this.AUXILIARY_PROVIDER_TIMEOUT_MS
  ): Promise<T> {
    const providerLease = this.providerInvocationSingleFlight.acquire(client);
    if (!providerLease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(client);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(client);
      }
      throw new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
    }

    try {
      await beforeProviderInvoke?.();
    } catch (error) {
      providerLease.releaseBeforeStart();
      throw error;
    }

    try {
      beforeProviderInvoke?.assertActive?.();
      if (
        this.connection.connected === false ||
        this.connection.getSocket() !== client
      ) {
        throw new Error(
          'Wwebjs connection unavailable: provider client is no longer active'
        );
      }
    } catch (error) {
      providerLease.releaseBeforeStart();
      await beforeProviderInvoke?.onStartRejected?.(error);
      throw error;
    }

    let failureReported = false;
    const providerCall = providerLease.start(invoke);
    void providerCall.catch((error: unknown) => {
      if (!failureReported) {
        failureReported = true;
        if (
          this.connection.reportOutboundSendFailure?.(client, error) === true
        ) {
          providerLease.markStalled();
        }
      }
    });

    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'wwebjs',
        operation,
        timeoutMs,
        invoke: () => providerCall,
      });
    } catch (error) {
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        providerLease.markStalled();
        if (!failureReported) {
          failureReported = true;
          const recoveryStarted = this.connection.reportOutboundSendFailure?.(
            client,
            error,
            {
              timedOut: true,
            }
          );
          if (recoveryStarted !== true) {
            this.connection.ensureOutboundSendRecovery?.(client);
          }
        } else {
          this.connection.ensureOutboundSendRecovery?.(client);
        }
      }
      throw error;
    }
  }

  async invokeProviderLookup<T>(
    client: Client,
    operation: WwebjsProviderLookupOperation,
    invoke: () => Promise<T>
  ): Promise<T> {
    const providerLease = this.providerInvocationSingleFlight.acquire(client);
    if (!providerLease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(client);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(client);
      }
      throw new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
    }
    const providerCall = providerLease.start(invoke);
    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'wwebjs',
        operation,
        timeoutMs: this.AUXILIARY_PROVIDER_TIMEOUT_MS,
        invoke: () => providerCall,
      });
    } catch (error) {
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        providerLease.markStalled();
        const recoveryStarted = this.connection.reportOutboundSendFailure?.(
          client,
          error,
          { timedOut: true }
        );
        if (recoveryStarted !== true) {
          this.connection.ensureOutboundSendRecovery?.(client);
        }
      }
      throw error;
    }
  }

  invokeProviderMutation<T>(
    client: Client,
    operation: WwebjsProviderMutationOperation,
    beforeProviderInvoke: WwebjsProviderInvocationBoundary | undefined,
    invoke: () => Promise<T>
  ): Promise<T> {
    return this.invokeAuxiliaryProvider(
      client,
      operation,
      beforeProviderInvoke,
      invoke,
      this.SEND_MESSAGE_TIMEOUT_MS
    );
  }

  private reportOutboundProtocolFailure(client: Client, error: Error): void {
    if (this.connection.reportOutboundSendFailure?.(client, error) === true) {
      this.providerInvocationSingleFlight.markStalled(client);
    }
  }

  private invokeProviderSendWithTimeout<T>(input: {
    invoke: () => Promise<T>;
    jid: string;
  }): Promise<T> {
    const timeoutMs = this.SEND_MESSAGE_TIMEOUT_MS;
    const startedAt = Date.now();

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        reject(new WwebjsSendMessageTimeoutError(timeoutMs));
      }, timeoutMs);
      timer.unref?.();

      /*
       * The provider call cannot be cancelled by whatsapp-web.js/Puppeteer.
       * Keep explicit fulfillment and rejection handlers attached after our
       * deadline so a late provider rejection never becomes unhandled.
       */
      let providerCall: Promise<T>;
      try {
        providerCall = input.invoke();
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
        return;
      }

      void providerCall.then(
        (value) => {
          if (settled) {
            console.warn(
              '[WwebjsSend] send_resolved_after_application_timeout',
              {
                jid_hash: hashWwebjsLogIdentifier(input.jid),
                timeout_ms: timeoutMs,
                duration_ms: Date.now() - startedAt,
              }
            );
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) {
            console.warn(
              '[WwebjsSend] send_rejected_after_application_timeout',
              {
                jid_hash: hashWwebjsLogIdentifier(input.jid),
                timeout_ms: timeoutMs,
                duration_ms: Date.now() - startedAt,
                error: this.describeError(error),
              }
            );
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private describeError(error: unknown) {
    return workerErrorDiagnostics(error);
  }

  private describeSendOptions(
    options?: Parameters<Client['sendMessage']>[2]
  ): Record<string, unknown> {
    if (!options || typeof options !== 'object') {
      return {};
    }

    const raw = options as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const keys: Array<keyof typeof raw> = [
      'waitUntilMsgSent',
      'sendAudioAsVoice',
      'sendMediaAsSticker',
      'sendMediaAsDocument',
      'sendVideoAsGif',
      'sendMediaAsHd',
      'isViewOnce',
      'quotedMessageId',
      'parseVCards',
      'caption',
      'mentions',
      'groupMentions',
      'extra',
    ];

    for (const key of keys) {
      const value = raw[key];
      if (value === undefined) {
        continue;
      }

      if (key === 'caption' && typeof value === 'string') {
        result.caption_length = value.length;
        continue;
      }

      if (key === 'quotedMessageId') {
        result.quoted_message_id_hash = hashWwebjsLogIdentifier(value);
        continue;
      }

      if (key === 'extra' && typeof value === 'object' && value !== null) {
        result.extra_keys = Object.keys(value as Record<string, unknown>);
        continue;
      }

      if (Array.isArray(value)) {
        result[String(key)] = { count: value.length };
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        result[String(key)] = { type: 'object' };
        continue;
      }

      result[String(key)] = value;
    }

    return result;
  }

  private describeOutgoingContent(
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): Record<string, unknown> {
    const description: Record<string, unknown> = {};

    if (typeof content === 'string') {
      description.kind = 'text';
      description.length = content.length;
      description.has_link = /https?:\/\//i.test(content);
      return description;
    }

    if (!content || typeof content !== 'object') {
      description.kind = typeof content;
      return description;
    }

    const asAny = content as unknown as Record<string, unknown>;

    if (
      typeof asAny.latitude === 'number' &&
      typeof asAny.longitude === 'number'
    ) {
      description.kind = 'location';
      description.has_name =
        typeof asAny.name === 'string' && asAny.name.length > 0;
      description.has_address =
        typeof asAny.address === 'string' && asAny.address.length > 0;
      return description;
    }

    if (typeof asAny.pollName === 'string') {
      description.kind = 'poll';
      const pollOptions = asAny.pollOptions;
      description.options_count = Array.isArray(pollOptions)
        ? pollOptions.length
        : 0;
      return description;
    }

    if (typeof asAny.mimetype === 'string') {
      description.kind = 'media';
      description.mimetype = asAny.mimetype;
      if (typeof asAny.filesize === 'number') {
        description.filesize = asAny.filesize;
      }
      const caption = (options as { caption?: unknown } | undefined)?.caption;
      if (typeof caption === 'string') {
        description.caption_length = caption.length;
      }
      return description;
    }

    const textValue = asAny.text;
    if (typeof textValue === 'string') {
      description.kind = 'text_object';
      description.length = textValue.length;
      return description;
    }

    description.kind = 'object';
    description.keys = Object.keys(asAny);
    return description;
  }

  private normalizeSendJidCandidate(
    value: string | null | undefined
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length ? normalized : undefined;
  }

  private extractMessageId(
    message: Awaited<ReturnType<Client['sendMessage']>>
  ): string | undefined {
    return extractWwebjsMessageId(message);
  }

  private async simulateHumanTyping(
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2],
    speed = 50,
    control?: ITypingSimulationControl
  ): Promise<void> {
    if (!jid) {
      return;
    }
    const checkpoint = (): void => control?.checkpoint();
    const sleep = (ms: number): Promise<void> =>
      control?.sleep(ms) ?? this.sleep(ms);

    const client = this.getClient();

    let chat:
      | (Awaited<ReturnType<Client['getChatById']>> & {
          sendStateTyping?: () => Promise<unknown>;
          clearState?: () => Promise<unknown>;
        })
      | null = null;

    checkpoint();
    try {
      chat = await client.getChatById(jid);
    } catch {
      return;
    }
    checkpoint();

    if (!chat) {
      return;
    }

    const sendStateTyping =
      typeof chat.sendStateTyping === 'function'
        ? chat.sendStateTyping.bind(chat)
        : null;
    const clearState =
      typeof chat.clearState === 'function' ? chat.clearState.bind(chat) : null;

    if (!sendStateTyping || !clearState) {
      return;
    }

    const text = this.extractText(content, options);
    const durationMs =
      this.estimateTypingMs(text) * typingSimulationDelayMultiplier(speed);

    const preThink = this.rand(100, 450);
    await sleep(preThink);

    const start = Date.now();
    let presenceActive = false;
    checkpoint();
    try {
      await sendStateTyping();
      presenceActive = true;
    } catch {
      return;
    }

    try {
      while (Date.now() - start < durationMs) {
        const elapsed = Date.now() - start;
        const remaining = durationMs - elapsed;
        const baseTick = this.rand(600, 1200);
        const tick = Math.min(baseTick, remaining);

        await sleep(tick);

        if (Date.now() - start < durationMs) {
          if (this.rngFloat() < 0.12) {
            checkpoint();
            await clearState();
            presenceActive = false;
            const thinkPause = this.rand(250, 750);
            await sleep(thinkPause);
            checkpoint();
            await sendStateTyping();
            presenceActive = true;
          } else {
            checkpoint();
            await sendStateTyping();
            presenceActive = true;
          }
        }
      }

      const windDown = this.rand(75, 250);
      await sleep(windDown);
    } finally {
      if (presenceActive && (control?.canCleanupPresence() ?? true)) {
        try {
          await clearState();
        } catch {}
      }
    }
  }

  private async runTypingSimulationBestEffort(
    simulate: (control: ITypingSimulationControl) => Promise<void>,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    await runTypingSimulationBestEffort({
      timeoutMs: this.TYPING_SIMULATION_MAX_DELAY_MS,
      providerReserveMs: this.SEND_MESSAGE_TIMEOUT_MS,
      beforeProviderInvoke,
      singleFlight: this.typingSimulationSingleFlight,
      simulate,
      onDeadline: ({ timeoutMs, durationMs }) => {
        console.warn('[WwebjsTypingSimulation] deadline exceeded', {
          timeout_ms: timeoutMs,
          duration_ms: durationMs,
        });
      },
      onFailure: (error) => {
        console.warn('[WwebjsTypingSimulation] failed before send', {
          ...workerErrorDiagnostics(error),
        });
      },
      onSingleFlightSkipped: () => {
        console.warn(
          '[WwebjsTypingSimulation] skipped while previous operation is still pending'
        );
      },
    });
  }

  private async getTypingSimulationConfig(): Promise<ITypingSimulationConfig> {
    try {
      return await this.typingSimulationRuntimeService.getConfig(
        wwebjsEnvironment.wwebjsWorkerId,
        wwebjsEnvironment.wwebjsAccountId
      );
    } catch (error) {
      console.error('[WwebjsTypingSimulation] config unavailable', {
        ...workerErrorDiagnostics(error),
      });

      return defaultTypingSimulationConfig();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private rngFloat(): number {
    const cryptoApi = (globalThis as any).crypto ?? nodeCrypto;
    const arr = new Uint32Array(1);
    cryptoApi.getRandomValues(arr);
    return arr[0] / 0x100000000;
  }

  private rand(min: number, max: number): number {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(this.rngFloat() * (b - a + 1)) + a;
  }

  private countGraphemes(value: string): number {
    return Array.from(value ?? '').length;
  }

  private estimateTypingMs(text: string): number {
    const len = this.countGraphemes(text);

    if (!len) {
      return this.rand(300, 700);
    }

    const baseCps = this.rand(7, 12);
    const base = (len / baseCps) * 1000;

    const punctCount = (text.match(/[.,!?;:]/g) || []).length;
    const newlineCount = (text.match(/\n/g) || []).length;
    const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;

    const punctPause = punctCount * this.rand(80, 220);
    const newlinePause = newlineCount * this.rand(120, 320);
    const emojiPause = emojiCount * this.rand(70, 180);

    const jitter = base * (this.rand(-5, 12) / 100);
    const total = base + punctPause + newlinePause + emojiPause + jitter;

    const minMs = 500;
    return Math.round(Math.max(minMs, total));
  }

  private extractText(
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): string {
    if (typeof content === 'string') {
      return content;
    }

    const caption = (options as { caption?: unknown } | undefined)?.caption;
    if (typeof caption === 'string') {
      return caption;
    }

    const textCandidate = (content as { text?: unknown } | undefined)?.text;
    if (typeof textCandidate === 'string') {
      return textCandidate;
    }

    return '';
  }

  private shouldSimulateTyping(
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): boolean {
    const parseVCards = (options as { parseVCards?: unknown } | undefined)
      ?.parseVCards;
    if (parseVCards === true) {
      return false;
    }

    if (typeof content === 'string') {
      const trimmed = content.trim().toUpperCase();
      if (trimmed.startsWith('BEGIN:VCARD') || trimmed.startsWith('MECARD:')) {
        return false;
      }

      return content.trim().length > 0;
    }

    const textCandidate = (content as { text?: unknown } | undefined)?.text;
    if (typeof textCandidate === 'string') {
      return textCandidate.trim().length > 0;
    }

    return false;
  }

  getOwnJid(): string {
    const client = this.getClient();
    const ownJidRaw = client.info?.wid?._serialized;

    if (!ownJidRaw) {
      throw new Error('Own JID not available');
    }

    const ownJid = normalizeJid(ownJidRaw);

    if (!ownJid) {
      throw new Error('Failed to normalize own JID');
    }

    return ownJid;
  }

  async resolveJid(raw: string): Promise<{ exists: boolean; jid?: string }> {
    const client = this.getClient();
    const normalizedRaw = this.normalizeSendJidCandidate(raw);
    if (!normalizedRaw) {
      return { exists: false };
    }

    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (candidate?: string) => {
      if (!candidate) {
        return;
      }

      const normalizedCandidate = candidate.trim();
      if (!normalizedCandidate || seen.has(normalizedCandidate)) {
        return;
      }

      seen.add(normalizedCandidate);
      candidates.push(normalizedCandidate);
    };

    addCandidate(normalizedRaw);
    addCandidate(normalizeJid(normalizedRaw));

    const digits = onlyDigits(normalizedRaw);
    if (digits) {
      const numericCandidates = buildCandidates(digits, {
        order: 'input_first',
      });

      for (const numericCandidate of numericCandidates) {
        addCandidate(onlyDigits(numericCandidate));
      }
    }

    if (!candidates.length) {
      return { exists: false };
    }

    const onWhatsAppResults = await this.invokeAuxiliaryProvider(
      client,
      'resolve_jid',
      undefined,
      () => client.onWhatsApp(candidates)
    );

    for (let i = 0; i < candidates.length; i++) {
      const item = onWhatsAppResults?.[i];
      const jid = item?.jid ? (normalizeJid(item.jid) ?? item.jid) : undefined;

      if (item?.exists && jid) {
        return { exists: true, jid };
      }
    }

    return { exists: false };
  }

  async updateProfileName(
    name: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    const client = this.getClient();
    await this.invokeAuxiliaryProvider(
      client,
      'update_profile_name',
      beforeProviderInvoke,
      () => client.setDisplayName(name)
    );
  }

  async updateProfileStatus(
    status: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    const client = this.getClient();
    await this.invokeAuxiliaryProvider(
      client,
      'update_profile_status',
      beforeProviderInvoke,
      () => client.setStatus(status)
    );
  }

  async removeProfilePicture(
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    const client = this.getClient();
    await this.invokeAuxiliaryProvider(
      client,
      'remove_profile_picture',
      beforeProviderInvoke,
      () => client.deleteProfilePicture()
    );
  }

  async updateProfilePicture(
    photoUrl: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    const client = this.getClient();
    const downloaded = await downloadMediaBuffer(photoUrl);
    const media = new MessageMedia(
      downloaded.contentType?.trim() || 'image/jpeg',
      downloaded.buffer.toString('base64'),
      downloaded.filename?.trim() || 'profile.jpg',
      downloaded.contentLength ?? downloaded.buffer.byteLength
    );
    await this.invokeAuxiliaryProvider(
      client,
      'update_profile_picture',
      beforeProviderInvoke,
      () => client.setProfilePicture(media),
      this.SEND_MESSAGE_TIMEOUT_MS
    );
  }

  addOwnJidToStatusList(statusJidList: string[]): string[] {
    try {
      const ownJid = this.getOwnJid();
      const normalizedStatusJidList = statusJidList.map(
        (jid) => normalizeJid(jid) ?? jid
      );
      const ownJidExists = normalizedStatusJidList.includes(ownJid);

      if (!ownJidExists) {
        return [...statusJidList, ownJid];
      }

      return statusJidList;
    } catch {
      return statusJidList;
    }
  }
}
