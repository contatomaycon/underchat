import { createHash, randomUUID } from 'node:crypto';
import { container, injectable } from 'tsyringe';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import type { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import type { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import type { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import type { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import type { IWhatsappRuntimeFenceActivationRequestProto } from '@core/common/interfaces/IWhatsappRuntimeFenceActivationProto';
import {
  defaultTypingSimulationConfig,
  normalizeTypingSimulationSpeed,
} from '@core/common/functions/typingSimulationConfig';
import { isWhatsappQrAttemptExhaustedState } from '@core/common/functions/isWhatsappQrAttemptExhaustedState';
import { getWorkerPostgresPool } from './workerPostgresPool';

interface RuntimeIdentity {
  accountId: string;
  capability: string;
  containerId: string;
  generation: number;
  workerId: string;
  writerEpoch: string;
}

export interface WorkerRuntimeConnectionStatusLeaseProof {
  ownerId: string;
  fencingToken: string;
}

export interface WorkerRuntimeEventPersistenceOptions {
  eventId?: string;
  connectionStatusLeaseProof?: WorkerRuntimeConnectionStatusLeaseProof;
}

export interface WorkerRuntimeOwnedConnectionFence {
  connection_epoch: string;
  connection_attempt_id?: string;
  connection_sequence: number;
  authorization_state: 'pending' | 'owned';
}

interface WorkerCallConfigRow {
  account_name: string;
  worker_name: string;
  worker_config_status_id: string | null;
  worker_config_type_id: string | null;
  value: string | null;
}

const DYNAMIC_CALL_TEMPLATE_PATTERN =
  /\{\{\s*(?:name|protocol|protocolo|user|sector)\s*\}\}/iu;

function runtimeIdentity(): RuntimeIdentity {
  const generation = Number(process.env.RUNTIME_GENERATION);
  const capability = process.env.WORKER_RUNTIME_CAPABILITY?.trim() ?? '';
  const writerEpoch = process.env.WORKER_WRITER_EPOCH?.trim() ?? '';
  const containerId = process.env.HOSTNAME?.trim() ?? '';
  const workerId = process.env.WORKER_ID?.trim() ?? '';
  const accountId = process.env.ACCOUNT_ID?.trim() ?? '';
  if (
    !Number.isSafeInteger(generation) ||
    generation <= 0 ||
    capability.length < 32 ||
    capability.length > 512 ||
    !/^[0-9a-f-]{36}$/iu.test(writerEpoch) ||
    !/^[0-9a-f]{12,64}$/iu.test(containerId) ||
    !workerId ||
    !accountId
  ) {
    throw new Error('worker_runtime_database_identity_invalid');
  }
  return {
    accountId,
    capability,
    containerId,
    generation,
    workerId,
    writerEpoch,
  };
}

function assertRuntimeOwner(
  identity: RuntimeIdentity,
  workerId: string | undefined,
  accountId: string | undefined
): void {
  if (
    workerId?.trim() !== identity.workerId ||
    accountId?.trim() !== identity.accountId
  ) {
    throw new Error('worker_runtime_database_scope_rejected');
  }
}

function sourceProvider(workerTypeId: string | undefined): string {
  switch (workerTypeId) {
    case EWorkerType.baileys:
      return 'baileys';
    case EWorkerType.wwebjs:
      return 'wwebjs';
    case EWorkerType.whatsmeow:
      return 'whatsmeow';
    default:
      throw new Error('worker_runtime_provider_invalid');
  }
}

function canonicalWorkerTypeId(workerTypeId: string | undefined): EWorkerType {
  const configuredWorkerTypeId = process.env.WORKER_TYPE_ID?.trim();
  const candidate = workerTypeId?.trim() || configuredWorkerTypeId;
  if (
    candidate === EWorkerType.baileys ||
    candidate === EWorkerType.wwebjs ||
    candidate === EWorkerType.whatsmeow
  ) {
    return candidate;
  }
  throw new Error('worker_runtime_provider_invalid');
}

function replaceLocalCallTags(
  template: string,
  input: {
    accountName: string;
    workerName: string;
    phone: string;
  }
): string {
  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour >= 5 && hour < 12
      ? 'Bom dia'
      : hour >= 12 && hour < 18
        ? 'Boa tarde'
        : 'Boa noite';
  return template
    .replaceAll(/\{\{\s*greeting\s*\}\}/giu, greeting)
    .replaceAll(/\{\{\s*date\s*\}\}/giu, now.toLocaleDateString('pt-BR'))
    .replaceAll(
      /\{\{\s*time\s*\}\}/giu,
      now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    )
    .replaceAll(
      /\{\{\s*(?:account_name|accountname)\s*\}\}/giu,
      input.accountName
    )
    .replaceAll(
      /\{\{\s*(?:channel_name|channelname)\s*\}\}/giu,
      input.workerName
    )
    .replaceAll(/\{\{\s*phone\s*\}\}/giu, input.phone);
}

@injectable()
export class WorkerRuntimeDatabaseService {
  private get pool() {
    return getWorkerPostgresPool();
  }

  async activateWhatsappRuntimeFence(
    payload: IWhatsappRuntimeFenceActivationRequestProto
  ): Promise<{ connection_sequence: number; already_active: boolean }> {
    const identity = runtimeIdentity();
    assertRuntimeOwner(identity, payload.worker_id, payload.account_id);
    const connectionAttemptId = payload.connection_attempt_id?.trim();
    const result = await this.pool.query<{
      activated: boolean;
      already_active: boolean;
      connection_sequence: number | string;
    }>(
      connectionAttemptId
        ? `SELECT activated, already_active, connection_sequence
             FROM activate_whatsapp_runtime_fence($1::uuid, $2::uuid, $3, $4,
                  $5::uuid, $6, $7, $8::uuid, $9::uuid)`
        : `SELECT activated, already_active, connection_sequence
             FROM activate_whatsapp_runtime_fence($1::uuid, $2::uuid, $3, $4,
                  $5::uuid, $6, $7, $8::uuid)`,
      [
        payload.worker_id,
        payload.account_id,
        payload.source_provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
        payload.connection_epoch,
        ...(connectionAttemptId ? [connectionAttemptId] : []),
      ]
    );
    const row = result.rows[0];
    const connectionSequence = Number(row?.connection_sequence);
    if (
      row?.activated !== true ||
      !Number.isSafeInteger(connectionSequence) ||
      connectionSequence <= 0
    ) {
      throw new Error('worker_runtime_fence_rejected');
    }
    return {
      connection_sequence: connectionSequence,
      already_active: row.already_active === true,
    };
  }

  async resolveWhatsappRuntimeOwnedConnectionFence(input: {
    worker_id?: string;
    account_id?: string;
    source_provider?: string;
    runtime_generation?: number;
  }): Promise<WorkerRuntimeOwnedConnectionFence | null> {
    const identity = runtimeIdentity();
    assertRuntimeOwner(identity, input.worker_id, input.account_id);
    if (
      input.runtime_generation !== identity.generation ||
      !input.source_provider?.trim()
    ) {
      throw new Error('worker_runtime_database_scope_rejected');
    }
    const result = await this.pool.query<{
      connection_epoch: string | null;
      connection_attempt_id: string | null;
      connection_sequence: number | string | null;
      authorization_state: string | null;
    }>(
      `SELECT connection_epoch, connection_attempt_id, connection_sequence,
              authorization_state
         FROM resolve_whatsapp_runtime_owned_connection_fence(
              $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7)`,
      [
        input.worker_id,
        input.account_id,
        input.source_provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
      ]
    );
    const row = result.rows[0];
    const connectionEpoch = row?.connection_epoch?.trim();
    const authorizationState = row?.authorization_state?.trim();
    const connectionSequence = Number(row?.connection_sequence);
    if (!connectionEpoch) {
      return null;
    }
    if (
      (authorizationState !== 'pending' && authorizationState !== 'owned') ||
      !Number.isSafeInteger(connectionSequence) ||
      connectionSequence < 0 ||
      (authorizationState === 'owned' && connectionSequence <= 0) ||
      (authorizationState === 'pending' && !row.connection_attempt_id?.trim())
    ) {
      throw new Error('worker_runtime_owned_connection_fence_invalid');
    }
    return {
      connection_epoch: connectionEpoch,
      connection_attempt_id: row.connection_attempt_id?.trim() || undefined,
      connection_sequence: connectionSequence,
      authorization_state: authorizationState,
    };
  }

  async notifyWorkerStatus(
    payload: IBaileysConnectionState,
    options: WorkerRuntimeEventPersistenceOptions = {}
  ): Promise<void> {
    await this.persistWorkerRuntimeEvent(payload, 'status', options);
    if (
      !this.hasAttemptCredential(payload) &&
      !isWhatsappQrAttemptExhaustedState(payload)
    ) {
      return;
    }

    // QR rotations and the attempt terminal are meaningful even while the
    // native provider snapshot and durable worker status remain unchanged.
    // Persist a non-business attempt event so neither boundary is lost to the
    // native/status deduplication performed by the database admission layer.
    await this.persistWorkerRuntimeEvent(
      this.attemptTelemetryPayload(payload),
      'telemetry'
    );
  }

  async publishWorkerRuntimeEvent(
    payload: IBaileysConnectionState,
    options: WorkerRuntimeEventPersistenceOptions = {}
  ): Promise<void> {
    await this.persistWorkerRuntimeEvent(payload, 'telemetry', options);
  }

  private hasAttemptCredential(payload: IBaileysConnectionState): boolean {
    if (!payload.connection_attempt_id?.trim()) {
      return false;
    }
    return Boolean(
      payload.qrcode?.trim() ||
      payload.pairing_code?.trim() ||
      payload.passkey_public_key?.trim() ||
      payload.passkey_confirmation_code?.trim()
    );
  }

  private attemptTelemetryPayload(
    payload: IBaileysConnectionState
  ): IBaileysConnectionState {
    const attemptPayload: IBaileysConnectionState = { ...payload };
    delete attemptPayload.connection_status;
    delete attemptPayload.connection_status_source_id;
    delete attemptPayload.worker_status_id;
    delete attemptPayload.disconnected_user;
    return attemptPayload;
  }

  private async persistWorkerRuntimeEvent(
    payload: IBaileysConnectionState,
    eventType: 'status' | 'telemetry',
    options: WorkerRuntimeEventPersistenceOptions = {}
  ): Promise<void> {
    const identity = runtimeIdentity();
    assertRuntimeOwner(identity, payload.worker_id, payload.account_id);
    const eventId = options.eventId?.trim() || randomUUID();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        eventId
      )
    ) {
      throw new Error('worker_runtime_event_id_invalid');
    }
    const workerTypeId = canonicalWorkerTypeId(payload.worker_type_id);
    const provider = sourceProvider(workerTypeId);
    const canonicalPayload: IBaileysConnectionState = {
      ...payload,
      worker_type_id: workerTypeId,
      runtime_generation: identity.generation,
      container_id: identity.containerId,
      event_type: eventType,
    };
    const privatePayload = canonicalPayload as IBaileysConnectionState &
      Record<string, unknown>;
    // Presentation and lifecycle envelopes are derived by the control plane;
    // a worker process cannot self-assert manager authority or observation.
    delete privatePayload.recreate_phase;
    delete privatePayload.recreate_phase_observed_at;
    delete privatePayload.recreate_runtime_retired;
    delete privatePayload.lifecycle_operation_id;
    delete privatePayload.lifecycle_source;
    delete privatePayload.lifecycle_action;
    delete privatePayload.lifecycle_phase;
    delete privatePayload.connection_status_observed_at;
    delete privatePayload.recreate_completed_operation_id;
    delete privatePayload.recreate_completed_runtime_generation;
    delete privatePayload.recreate_completed_at;
    const leaseProof = options.connectionStatusLeaseProof;
    if (leaseProof) {
      const ownerId = leaseProof.ownerId.trim();
      const fencingToken = leaseProof.fencingToken.trim();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          ownerId
        ) ||
        !/^[1-9][0-9]*$/.test(fencingToken)
      ) {
        throw new Error('worker_runtime_connection_status_lease_proof_invalid');
      }
      privatePayload.connection_status_lease_owner_id = ownerId;
      privatePayload.connection_status_fencing_token = fencingToken;
    }
    const result = await this.pool.query<{ outcome: string }>(
      `SELECT outcome
         FROM apply_worker_runtime_status($1::uuid, $2::uuid, $3, $4, $5::uuid,
              $6, $7, $8::jsonb, $9::uuid)`,
      [
        payload.worker_id,
        payload.account_id,
        provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
        JSON.stringify(privatePayload),
        eventId,
      ]
    );
    const outcome = result.rows[0]?.outcome;
    if (
      outcome !== 'applied' &&
      outcome !== 'idempotent' &&
      outcome !== 'duplicate' &&
      outcome !== 'deferred'
    ) {
      throw new Error(`worker_runtime_status_rejected:${outcome ?? 'unknown'}`);
    }
  }

  async requestWorkerSelfHealing(
    payload: IWorkerSelfHealingRequestProto
  ): Promise<void> {
    const identity = runtimeIdentity();
    assertRuntimeOwner(identity, payload.worker_id, payload.account_id);
    const provider = sourceProvider(
      canonicalWorkerTypeId(payload.worker_type_id)
    );
    const requestKey = createHash('sha256')
      .update(
        `${payload.worker_id}\0${identity.generation}\0${payload.reason ?? ''}`
      )
      .digest('hex');
    const result = await this.pool.query<{
      request_id: string | null;
      created: boolean;
    }>(
      `SELECT request_id
         FROM request_worker_self_heal($1::uuid, $2::uuid, $3, $4, $5::uuid,
              $6, $7, $8, $9::jsonb, $10)`,
      [
        payload.worker_id,
        payload.account_id,
        provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
        payload.reason ?? 'worker_degraded',
        JSON.stringify(payload),
        requestKey,
      ]
    );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        result.rows[0]?.request_id?.trim() ?? ''
      )
    ) {
      throw new Error('worker_self_heal_request_rejected');
    }
  }

  async getTypingSimulationConfig(
    workerId: string,
    accountId: string
  ): Promise<IGetTypingSimulationConfigResponseProto> {
    const identity = runtimeIdentity();
    assertRuntimeOwner(identity, workerId, accountId);
    const workerTypeId = canonicalWorkerTypeId(undefined);
    const provider = sourceProvider(workerTypeId);
    const result = await this.pool.query<{
      value: string | null;
      worker_config_status_id: string | null;
    }>(
      `SELECT value, worker_config_status_id
         FROM read_whatsapp_worker_typing_config(
           $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8::uuid
         )`,
      [
        workerId,
        accountId,
        provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
        EWorkerConfigType.typing_simulation,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('worker_runtime_database_fence_rejected');
    }
    if (!row?.worker_config_status_id) return defaultTypingSimulationConfig();
    return {
      enabled: row.worker_config_status_id !== EWorkerConfigStatus.inactive,
      speed: normalizeTypingSimulationSpeed(row.value),
    };
  }

  async resolveIncomingCallAction(
    payload: IResolveIncomingCallActionRequestProto
  ): Promise<IResolveIncomingCallActionResponseProto> {
    const identity = runtimeIdentity();
    assertRuntimeOwner(identity, payload.worker_id, payload.account_id);
    const workerTypeId = canonicalWorkerTypeId(undefined);
    const provider = sourceProvider(workerTypeId);
    const result = await this.pool.query<WorkerCallConfigRow>(
      `SELECT account_name, worker_name, worker_config_type_id,
              worker_config_status_id, value
         FROM read_whatsapp_worker_call_config(
           $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7,
           $8::uuid, $9::uuid
         )`,
      [
        payload.worker_id,
        payload.account_id,
        provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
        EWorkerConfigType.reject_call,
        EWorkerConfigType.show_message_on_call,
      ]
    );
    if (result.rows.length === 0) {
      throw new Error('worker_runtime_database_fence_rejected');
    }
    const active = result.rows.filter(
      (row) => row.worker_config_status_id === EWorkerConfigStatus.active
    );
    const rejectCall = active.some(
      (row) => row.worker_config_type_id === EWorkerConfigType.reject_call
    );
    const template =
      active
        .find(
          (row) =>
            row.worker_config_type_id === EWorkerConfigType.show_message_on_call
        )
        ?.value?.trim() ?? '';
    if (!template) {
      return {
        reject_call: rejectCall,
        show_message_on_call: false,
        show_message_text: '',
      };
    }

    const first = result.rows[0] as WorkerCallConfigRow;
    const phone = payload.call_phone?.replaceAll(/\D/gu, '') ?? '';
    const fallback = replaceLocalCallTags(template, {
      accountName: first.account_name,
      workerName: first.worker_name,
      phone,
    });
    const rendered = DYNAMIC_CALL_TEMPLATE_PATTERN.test(template)
      ? await this.renderDynamicCallTemplate(payload, template, fallback, {
          accountName: first.account_name,
          workerName: first.worker_name,
        })
      : fallback;
    return {
      reject_call: rejectCall,
      show_message_on_call: rendered.trim().length > 0,
      show_message_text: rendered,
    };
  }

  private async renderDynamicCallTemplate(
    payload: IResolveIncomingCallActionRequestProto,
    template: string,
    fallback: string,
    names: { accountName: string; workerName: string }
  ): Promise<string> {
    try {
      // Loading ChatService only for dynamic templates keeps the common
      // status/config path small while still using the worker's existing
      // Elasticsearch, Redis and PostgreSQL clients directly.
      const { ChatService } = await import('./chat.service');
      const rendered = await container
        .resolve(ChatService)
        .renderIncomingCallTemplate({
          accountId: payload.account_id ?? '',
          accountName: names.accountName,
          workerId: payload.worker_id ?? '',
          workerName: names.workerName,
          template,
          callJid: payload.call_jid,
          callPhone: payload.call_phone,
        });
      return rendered.trim() ? rendered : fallback;
    } catch {
      return fallback;
    }
  }

  async registerS3BackupFallbackUpload(
    payload: IRegisterS3BackupFallbackUploadRequestProto
  ): Promise<void> {
    const identity = runtimeIdentity();
    if (payload.account_id?.trim() !== identity.accountId) {
      throw new Error('worker_runtime_database_scope_rejected');
    }
    const workerTypeId = canonicalWorkerTypeId(undefined);
    const provider = sourceProvider(workerTypeId);
    const result = await this.pool.query<{ upload_id: string }>(
      `SELECT register_whatsapp_worker_s3_backup(
         $1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15, $16
       ) AS upload_id`,
      [
        identity.workerId,
        payload.account_id,
        provider,
        identity.generation,
        identity.writerEpoch,
        identity.capability,
        identity.containerId,
        payload.bucket,
        payload.object_key,
        payload.file_name ?? '',
        payload.content_type ?? '',
        Number(payload.size_bytes ?? 0),
        Number(payload.primary_attempts ?? 0),
        Number(payload.backup_attempts ?? 0),
        payload.primary_error ?? '',
        payload.backup_error ?? '',
      ]
    );
    if (!/^[0-9a-f-]{36}$/iu.test(result.rows[0]?.upload_id ?? '')) {
      throw new Error('worker_runtime_database_fence_rejected');
    }
  }
}
