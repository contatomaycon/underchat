import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessage,
  WAMediaUpload,
  WASocket,
  generateMessageIDV2,
  generateWAMessageContent,
  generateWAMessageFromContent,
  proto,
} from '@whiskeysockets/baileys';
import { injectable, inject } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { createHash, webcrypto as nodeCrypto } from 'node:crypto';
import { BaileysDeliveryConfirmationService } from './deliveryConfirmation.service';
import { TypingSimulationRuntimeService } from '@core/services/typingSimulationRuntime.service';
import { baileysEnvironment } from '@core/config/environments';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';
import {
  defaultTypingSimulationConfig,
  resolveTypingSimulationMaxDelayMs,
  typingSimulationDelayMultiplier,
} from '@core/common/functions/typingSimulationConfig';
import {
  BaileysSendMessageTimeoutError,
  invokeBaileysProviderSendWithTimeout,
  resolveBaileysSendMessageTimeoutMs,
} from '../util/providerSendTimeout';
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
import {
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';
import { BaileysProviderProtocolFailureError } from '../util/providerOperationFailure';

function hashBaileysSendLogIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return `sha256:${createHash('sha256').update(value.trim()).digest('hex')}`;
}

@injectable()
export class BaileysHelpersService {
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;
  private readonly SEND_MESSAGE_TIMEOUT_MS =
    resolveBaileysSendMessageTimeoutMs();
  private readonly TYPING_SIMULATION_MAX_DELAY_MS =
    resolveTypingSimulationMaxDelayMs();
  private readonly AUXILIARY_PROVIDER_TIMEOUT_MS =
    resolveProviderAuxiliaryTimeoutMs();
  private readonly typingSimulationSingleFlight =
    new TypingSimulationSingleFlight();
  private readonly providerInvocationSingleFlight =
    new ProviderInvocationSingleFlight();

  constructor(
    @inject(BaileysConnectionService)
    private readonly connection: BaileysConnectionService,
    @inject(BaileysDeliveryConfirmationService)
    private readonly deliveryConfirmation: BaileysDeliveryConfirmationService,
    @inject(TypingSimulationRuntimeService)
    private readonly typingSimulationRuntimeService: TypingSimulationRuntimeService
  ) {}

  async send(
    address: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<WAMessage | undefined> {
    const sock = this.socket();
    this.assertSocketReadyForSend(sock);

    const shouldSimulateTyping = this.shouldSimulateTyping(content);
    const isEditMessage = this.isEditMessage(content);
    let jid = address;

    if (!address.includes('@')) {
      const resolved = await this.resolveJidFlexible(sock, address);
      if (!resolved.exists || !resolved.jid) {
        throw new Error(`Number not found on WhatsApp: ${address}`);
      }
      jid = resolved.jid;
    }

    if (shouldSimulateTyping) {
      await this.runTypingSimulationBestEffort(async (control) => {
        control.checkpoint();
        const typingConfig = await this.getTypingSimulationConfig();
        control.checkpoint();
        if (typingConfig.enabled) {
          await this.simulateHumanTyping(
            jid,
            content,
            typingConfig.speed,
            control
          );
        }
      }, beforeProviderInvoke);
    }

    const result = await this.sendOnce(
      sock,
      jid,
      content,
      options,
      beforeProviderInvoke
    );
    const messageId = result?.key?.id;
    if (!messageId) {
      const error = new BaileysProviderProtocolFailureError(
        'Failed to send message: missing key.id'
      );
      this.reportOutboundProtocolFailure(sock, error);
      throw error;
    }
    this.connection.reportOutboundSendSuccess?.(sock);

    if (isEditMessage) {
      return result;
    }

    // `sock.sendMessage` resolving with a provider message ID is the durable
    // acceptance boundary. Delivery confirmation is useful telemetry, but it
    // must not hold that result hostage or turn an accepted send into a retry.
    void this.observeDeliveryConfirmation(messageId);
    return result;
  }

  private async observeDeliveryConfirmation(messageId: string): Promise<void> {
    try {
      const outcome = await this.deliveryConfirmation.waitForOutcome(
        messageId,
        this.SEND_CONFIRMATION_TIMEOUT_MS
      );
      if (outcome !== 'sent') {
        console.warn(
          '[BaileysSend] delivery_confirmation_unconfirmed_after_provider_accept',
          {
            message_id_hash: hashBaileysSendLogIdentifier(messageId),
            outcome: outcome === 'failed' ? 'failed' : 'timeout',
          }
        );
      }
    } catch (error) {
      console.warn(
        '[BaileysSend] delivery_confirmation_observation_failed_after_provider_accept',
        {
          message_id_hash: hashBaileysSendLogIdentifier(messageId),
          ...workerErrorDiagnostics(error),
        }
      );
    }
  }

  private async sendOnce(
    sock: WASocket,
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<WAMessage> {
    if (this.isAudioViewOnceMessage(content)) {
      const result = await this.sendAudioViewOnceMessage(
        sock,
        jid,
        content,
        options,
        beforeProviderInvoke
      );

      if (!result) {
        const error = new BaileysProviderProtocolFailureError(
          `Failed to send message to ${jid}: result is undefined`
        );
        this.reportOutboundProtocolFailure(sock, error);
        throw error;
      }

      return result;
    }

    const result = await this.invokeOutboundProvider(
      sock,
      'send_message',
      beforeProviderInvoke,
      () => sock.sendMessage(jid, content, options)
    );

    if (!result) {
      const error = new BaileysProviderProtocolFailureError(
        `Failed to send message to ${jid}: result is undefined`
      );
      this.reportOutboundProtocolFailure(sock, error);
      throw error;
    }

    return result;
  }

  private async invokeOutboundProvider<T>(
    sock: WASocket,
    operation: 'relay_message' | 'send_message',
    beforeProviderInvoke: IProviderInvocationBoundary | undefined,
    invoke: () => Promise<T>
  ): Promise<T> {
    const lease = this.providerInvocationSingleFlight.acquire(sock);
    if (!lease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(sock);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(sock);
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
      if (this.connection.getSocket() !== sock) {
        throw new Error(
          'Baileys connection unavailable: provider socket was replaced'
        );
      }
      this.assertSocketReadyForSend(sock);
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
        if (this.connection.reportOutboundSendFailure?.(sock, error) === true) {
          lease.markStalled();
        }
      }
    });

    try {
      return await invokeBaileysProviderSendWithTimeout({
        invoke: () => providerCall,
        operation,
        timeoutMs: this.SEND_MESSAGE_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof BaileysSendMessageTimeoutError && !failureReported) {
        failureReported = true;
        lease.markStalled();
        this.connection.reportOutboundSendFailure?.(sock, error, {
          timedOut: true,
        });
      }
      throw error;
    }
  }

  private async invokeAuxiliaryProvider<T>(
    sock: WASocket,
    operation: string,
    beforeProviderInvoke: IProviderInvocationBoundary | undefined,
    invoke: () => Promise<T>,
    timeoutMs = this.AUXILIARY_PROVIDER_TIMEOUT_MS
  ): Promise<T> {
    const providerLease = this.providerInvocationSingleFlight.acquire(sock);
    if (!providerLease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(sock);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(sock);
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
      if (this.connection.getSocket() !== sock) {
        throw new Error(
          'Baileys connection unavailable: provider socket was replaced'
        );
      }
      this.assertSocketReadyForSend(sock);
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
        if (this.connection.reportOutboundSendFailure?.(sock, error) === true) {
          providerLease.markStalled();
        }
      }
    });

    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'baileys',
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
            sock,
            error,
            {
              timedOut: true,
            }
          );
          if (recoveryStarted !== true) {
            this.connection.ensureOutboundSendRecovery?.(sock);
          }
        } else {
          this.connection.ensureOutboundSendRecovery?.(sock);
        }
      }
      throw error;
    }
  }

  private reportOutboundProtocolFailure(sock: WASocket, error: Error): void {
    if (this.connection.reportOutboundSendFailure?.(sock, error) === true) {
      this.providerInvocationSingleFlight.markStalled(sock);
    }
  }

  private async getTypingSimulationConfig(): Promise<ITypingSimulationConfig> {
    try {
      return await this.typingSimulationRuntimeService.getConfig(
        baileysEnvironment.baileysWorkerId,
        baileysEnvironment.baileysAccountId
      );
    } catch (error) {
      console.error('[BaileysTypingSimulation] config unavailable', {
        ...workerErrorDiagnostics(error),
      });

      return defaultTypingSimulationConfig();
    }
  }

  private async simulateHumanTyping(
    jid: string,
    content: AnyMessageContent,
    speed = 50,
    control?: ITypingSimulationControl
  ) {
    const sock = this.socket();
    if (!sock.user?.id) {
      return;
    }
    const checkpoint = (): void => control?.checkpoint();
    const sleep = (ms: number): Promise<void> =>
      control?.sleep(ms) ?? this.sleep(ms);

    const text = this.extractText(content);
    const durationMs =
      this.estimateTypingMs(text) * typingSimulationDelayMultiplier(speed);

    const preThink = this.rand(100, 450);
    await sleep(preThink);

    const start = Date.now();
    let presenceActive = false;
    try {
      checkpoint();
      await sock.sendPresenceUpdate('composing', jid);
      presenceActive = true;

      while (Date.now() - start < durationMs) {
        const elapsed = Date.now() - start;
        const remaining = durationMs - elapsed;

        const baseTick = this.rand(600, 1200);
        const tick = Math.min(baseTick, remaining);
        await sleep(tick);

        if (Date.now() - start < durationMs) {
          if (this.rngFloat() < 0.12) {
            checkpoint();
            await sock.sendPresenceUpdate('paused', jid);
            presenceActive = false;
            const thinkPause = this.rand(250, 750);
            await sleep(thinkPause);
            checkpoint();
            await sock.sendPresenceUpdate('composing', jid);
            presenceActive = true;
          } else {
            checkpoint();
            await sock.sendPresenceUpdate('composing', jid);
            presenceActive = true;
          }
        }
      }

      const windDown = this.rand(75, 250);
      await sleep(windDown);
    } finally {
      if (presenceActive && (control?.canCleanupPresence() ?? true)) {
        try {
          await sock.sendPresenceUpdate('paused', jid);
        } catch {}
      }
    }
  }

  private async runTypingSimulationBestEffort(
    simulate: (control: ITypingSimulationControl) => Promise<void>,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<void> {
    await runTypingSimulationBestEffort({
      timeoutMs: this.TYPING_SIMULATION_MAX_DELAY_MS,
      providerReserveMs: this.SEND_MESSAGE_TIMEOUT_MS,
      beforeProviderInvoke,
      singleFlight: this.typingSimulationSingleFlight,
      simulate,
      onDeadline: ({ timeoutMs, durationMs }) => {
        console.warn('[BaileysTypingSimulation] deadline exceeded', {
          timeout_ms: timeoutMs,
          duration_ms: durationMs,
        });
      },
      onFailure: (error) => {
        console.warn('[BaileysTypingSimulation] failed before send', {
          ...workerErrorDiagnostics(error),
        });
      },
      onSingleFlightSkipped: () => {
        console.warn(
          '[BaileysTypingSimulation] skipped while previous operation is still pending'
        );
      },
    });
  }

  private socket(): WASocket {
    const s = this.connection.getSocket();
    if (!s) {
      throw new Error('Socket not connected');
    }
    return s;
  }

  private isAudioViewOnceMessage(
    content: AnyMessageContent
  ): content is AnyMessageContent & {
    audio: WAMediaUpload;
    viewOnce: true;
  } {
    const maybeAudio = (content as { audio?: unknown }).audio;
    const maybeViewOnce = (content as { viewOnce?: unknown }).viewOnce;
    return !!maybeAudio && maybeViewOnce === true;
  }

  private async sendAudioViewOnceMessage(
    sock: WASocket,
    jid: string,
    content: AnyMessageContent & {
      audio: WAMediaUpload;
      viewOnce: true;
    },
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<WAMessage> {
    const ownJid = sock.user?.id;
    if (!ownJid) {
      throw new Error(
        'Baileys connection unavailable: auth state is not ready'
      );
    }

    const rawSeconds = (content as { seconds?: unknown }).seconds;
    const seconds = this.toPositiveNumber(rawSeconds);
    const ptt = (content as { ptt?: unknown }).ptt === true;
    const waveform = this.toWaveform(
      ptt ? (content as { waveform?: unknown }).waveform : undefined
    );
    const mimetype = this.toNonEmptyString(
      (content as { mimetype?: unknown }).mimetype
    );
    const contextInfo = (content as { contextInfo?: proto.IContextInfo })
      .contextInfo;

    const mediaContent: AnyMessageContent = {
      audio: content.audio,
      ptt,
      seconds,
      waveform,
      mimetype,
      contextInfo,
    };

    const generatedMediaMessage = await this.invokeAuxiliaryProvider(
      sock,
      'prepare_view_once_audio',
      undefined,
      () =>
        generateWAMessageContent(mediaContent, {
          upload: sock.waUploadToServer,
          mediaUploadTimeoutMs: options?.mediaUploadTimeoutMs,
        }),
      this.SEND_MESSAGE_TIMEOUT_MS
    );

    const audioMessageWithViewOnce = proto.Message.AudioMessage.fromObject({
      ...generatedMediaMessage.audioMessage,
      viewOnce: true,
    });

    const wrappedMessage = proto.Message.fromObject({
      viewOnceMessage: {
        message: proto.Message.fromObject({
          audioMessage: audioMessageWithViewOnce,
        }),
      },
      messageContextInfo: generatedMediaMessage.messageContextInfo,
    });

    const fullMessage = generateWAMessageFromContent(jid, wrappedMessage, {
      userJid: ownJid,
      messageId: options?.messageId ?? generateMessageIDV2(ownJid),
      timestamp: options?.timestamp,
      quoted: options?.quoted,
      ephemeralExpiration: options?.ephemeralExpiration,
    });

    if (!fullMessage.message) {
      throw new Error(
        'Failed to send view-once audio: message payload missing'
      );
    }
    const relayPayload = fullMessage.message;

    await this.invokeOutboundProvider(
      sock,
      'relay_message',
      beforeProviderInvoke,
      () =>
        sock.relayMessage(jid, relayPayload, {
          messageId: fullMessage.key.id ?? undefined,
          useCachedGroupMetadata: options?.useCachedGroupMetadata,
          statusJidList: options?.statusJidList,
        })
    );

    return fullMessage;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return undefined;
  }

  private toWaveform(value: unknown): Uint8Array | undefined {
    if (value instanceof Uint8Array && value.length > 0) {
      return value;
    }
    return undefined;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private assertSocketReadyForSend(sock: WASocket): void {
    if (!this.connection.connected) {
      throw new Error(
        'Baileys connection unavailable: socket is not connected yet'
      );
    }

    const ownJid = sock.user?.id;
    if (!ownJid) {
      throw new Error(
        'Baileys connection unavailable: auth state is not ready yet'
      );
    }
  }

  private async resolveJidFlexible(sock: WASocket, raw: string) {
    const candidates = buildCandidates(raw, { order: 'input_first' });

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const resp = await this.invokeAuxiliaryProvider(
        sock,
        'resolve_jid',
        undefined,
        () => sock.onWhatsApp(onlyDigits(candidate))
      );
      const item = resp?.[0];
      const jid = item?.jid ? normalizeJid(item.jid) : undefined;

      if (item?.exists && jid) {
        return { exists: true as const, jid };
      }
    }

    return { exists: false as const, jid: undefined };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private rngFloat() {
    const cryptoApi = (globalThis as any).crypto ?? nodeCrypto;
    const arr = new Uint32Array(1);
    cryptoApi.getRandomValues(arr);
    return arr[0] / 0x100000000;
  }

  private rand(min: number, max: number) {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(this.rngFloat() * (b - a + 1)) + a;
  }

  private countGraphemes(str: string) {
    return Array.from(str ?? '').length;
  }

  private isReactionOrEdit(content: AnyMessageContent): boolean {
    return !!(content as any)?.react || !!(content as any)?.edit;
  }

  private isEditMessage(content: AnyMessageContent): boolean {
    return !!(content as { edit?: unknown })?.edit;
  }

  private shouldSimulateTyping(content: AnyMessageContent): boolean {
    if (this.isReactionOrEdit(content)) {
      return false;
    }

    const text = (content as any)?.text;
    return typeof text === 'string' && text.trim().length > 0;
  }

  private extractText(content: AnyMessageContent) {
    if ((content as any)?.text) return String((content as any).text);
    if ((content as any)?.caption) return String((content as any).caption);
    if ((content as any)?.extendedTextMessage?.text)
      return String((content as any).extendedTextMessage.text);
    if ((content as any)?.react?.text)
      return String((content as any).react.text);
    return '';
  }

  private estimateTypingMs(text: string) {
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

  getOwnJid(): string {
    const sock = this.socket();
    const ownJidRaw = sock.user?.id;

    if (!ownJidRaw) {
      throw new Error('Own JID not available');
    }

    const ownJid = normalizeJid(ownJidRaw);

    if (!ownJid) {
      throw new Error('Failed to normalize own JID');
    }

    return ownJid;
  }

  async updateProfileName(
    name: string,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<void> {
    const sock = this.socket();
    await this.invokeAuxiliaryProvider(
      sock,
      'update_profile_name',
      beforeProviderInvoke,
      () => sock.updateProfileName(name)
    );
  }

  async updateProfileStatus(
    status: string,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<void> {
    const sock = this.socket();
    await this.invokeAuxiliaryProvider(
      sock,
      'update_profile_status',
      beforeProviderInvoke,
      () => sock.updateProfileStatus(status)
    );
  }

  async removeProfilePicture(
    jid: string,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<void> {
    const sock = this.socket();
    await this.invokeAuxiliaryProvider(
      sock,
      'remove_profile_picture',
      beforeProviderInvoke,
      () => sock.removeProfilePicture(jid)
    );
  }

  async updateProfilePicture(
    photoUrl: string,
    beforeProviderInvoke?: IProviderInvocationBoundary
  ): Promise<void> {
    const sock = this.socket();
    const ownJid = this.getOwnJid();
    await this.invokeAuxiliaryProvider(
      sock,
      'update_profile_picture',
      beforeProviderInvoke,
      () => sock.updateProfilePicture(ownJid, { url: photoUrl }),
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
