import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { container } from 'tsyringe';
import * as schema from '@core/models';
import {
  OUTBOUND_WEBHOOK_EVENT_SERVICE_TOKEN,
  type OutboundWebhookEventServicePort,
} from '@core/common/interfaces/IOutboundWebhookEventService';
import { OutboundWebhookEventService } from '@core/services/outboundWebhookEvent.service';
import {
  closeWorkerPostgresPool,
  getWorkerPostgresPool,
  getWorkerScopedPostgresPool,
} from '@core/services/workerPostgresPool';
import { EWorkerType } from '@core/common/enums/EWorkerType';

interface WarmRuntimeHydrationRow {
  worker_id: string;
  account_id: string;
  worker_type_id: string;
  runtime_generation: number | string;
  writer_epoch: string;
  session_storage: string;
}

function runtimeProvider(workerTypeId: string): string {
  if (workerTypeId === EWorkerType.baileys) return 'baileys';
  if (workerTypeId === EWorkerType.wwebjs) return 'wwebjs';
  if (workerTypeId === EWorkerType.whatsmeow) return 'whatsmeow';
  throw new Error('worker_runtime_provider_invalid');
}

async function hydrateAssignedWarmRuntime(pool: Pool): Promise<void> {
  if (process.env.WARM_STANDBY?.trim().toLowerCase() !== 'true') return;
  const warmPoolId = process.env.WARM_POOL_ID?.trim() ?? '';
  const capability = process.env.WORKER_RUNTIME_CAPABILITY?.trim() ?? '';
  const containerId = process.env.HOSTNAME?.trim() ?? '';
  if (!warmPoolId || capability.length < 32 || !containerId) return;

  const result = await pool.query<WarmRuntimeHydrationRow>(
    `SELECT worker_id, account_id, worker_type_id, runtime_generation,
            writer_epoch, session_storage
       FROM hydrate_whatsapp_warm_runtime($1::uuid, $2, $3)`,
    [warmPoolId, capability, containerId]
  );
  const row = result.rows[0];
  if (!row) return;
  const generation = Number(row.runtime_generation);
  if (
    row.session_storage !== 'postgres' ||
    row.worker_type_id !== process.env.WORKER_TYPE_ID?.trim() ||
    !Number.isSafeInteger(generation) ||
    generation <= 0 ||
    !row.worker_id ||
    !row.account_id ||
    !row.writer_epoch
  ) {
    throw new Error('worker_warm_runtime_hydration_invalid');
  }
  process.env.WORKER_ID = row.worker_id;
  process.env.ACCOUNT_ID = row.account_id;
  process.env.RUNTIME_GENERATION = String(generation);
  process.env.WORKER_WRITER_EPOCH = row.writer_epoch;
  process.env.WORKER_SESSION_STORAGE = row.session_storage;
  process.env.WARM_STANDBY = 'false';
}

export async function activateCurrentWorkerRuntimeFence(
  pool: Pool = getWorkerPostgresPool()
): Promise<void> {
  await activateWorkerRuntimeFence(
    {
      workerId: process.env.WORKER_ID?.trim() ?? '',
      accountId: process.env.ACCOUNT_ID?.trim() ?? '',
      workerTypeId: process.env.WORKER_TYPE_ID?.trim() ?? '',
      generation: Number(process.env.RUNTIME_GENERATION),
      writerEpoch: process.env.WORKER_WRITER_EPOCH?.trim() ?? '',
      capability: process.env.WORKER_RUNTIME_CAPABILITY?.trim() ?? '',
    },
    pool
  );
}

export async function activateWorkerRuntimeFence(
  input: {
    workerId: string;
    accountId: string;
    workerTypeId: string;
    generation: number;
    writerEpoch: string;
    capability: string;
  },
  pool: Pool = getWorkerPostgresPool()
): Promise<void> {
  const workerId = input.workerId.trim();
  const accountId = input.accountId.trim();
  const workerTypeId = input.workerTypeId.trim();
  const generation = Number(input.generation);
  const writerEpoch = input.writerEpoch.trim();
  const capability = input.capability.trim();
  const containerId = process.env.HOSTNAME?.trim() ?? '';
  if (
    !workerId ||
    !accountId ||
    !Number.isSafeInteger(generation) ||
    generation <= 0 ||
    !writerEpoch ||
    capability.length < 32 ||
    !containerId
  ) {
    throw new Error('worker_runtime_database_identity_invalid');
  }
  const result = await pool.query<{
    activated: boolean;
    connection_sequence: number | string | null;
  }>(
    `SELECT activated, connection_sequence
       FROM activate_whatsapp_runtime_fence($1::uuid, $2::uuid, $3, $4,
            $5::uuid, $6, $7, $8::uuid)`,
    [
      workerId,
      accountId,
      runtimeProvider(workerTypeId),
      generation,
      writerEpoch,
      capability,
      containerId,
      randomUUID(),
    ]
  );
  const row = result.rows[0];
  const sequence = Number(row?.connection_sequence);
  if (
    row?.activated !== true ||
    !Number.isSafeInteger(sequence) ||
    sequence <= 0
  ) {
    throw new Error('worker_runtime_fence_rejected');
  }
}

/**
 * Worker-scoped Drizzle registration backed by the single session/runtime
 * pool (min=0/max=2). It intentionally does not parse or log the DSN and does
 * not own any migrations.
 */
async function workerDatabasePlugin(fastify: FastifyInstance): Promise<void> {
  const pool = getWorkerPostgresPool();
  await hydrateAssignedWarmRuntime(pool);
  if (process.env.WARM_STANDBY?.trim().toLowerCase() !== 'true') {
    await activateCurrentWorkerRuntimeFence(pool);
  }
  const database = drizzle(getWorkerScopedPostgresPool(), { schema });

  container.register<NodePgDatabase<typeof schema>>('DatabaseRw', {
    useValue: database,
  });
  container.register<NodePgDatabase<typeof schema>>('DatabaseRo', {
    useValue: database,
  });
  container.register<OutboundWebhookEventServicePort>(
    OUTBOUND_WEBHOOK_EVENT_SERVICE_TOKEN,
    { useClass: OutboundWebhookEventService }
  );

  fastify.addHook('onClose', async (): Promise<void> => {
    await closeWorkerPostgresPool();
  });
}

export default fp(workerDatabasePlugin, { name: 'worker-database-plugin' });
