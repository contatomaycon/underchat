import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { WorkerCommandJsonObject } from '@core/common/interfaces/IWorkerCommandEnvelope';

/**
 * Builds the provider payload while excluding transport/projection metadata.
 * The same logical message therefore produces the same digest before and
 * after Elasticsearch records a PubAck or webhook-journal markers.
 */
export function workerCommandMessagePayload(
  input: IChatMessage
): WorkerCommandJsonObject {
  const message = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  for (const field of [
    'outbound_webhook_event_ids',
    'inbound_event_ids',
    'broker_command_id',
    'broker_operation_id',
    'broker_stream',
    'broker_stream_sequence',
    'broker_accepted_at',
    'broker_expires_at',
    'broker_duplicate',
    'worker_command_transport',
    'worker_command_issued_at',
    'worker_command_retry_of',
    'worker_command_deadline_at',
    'worker_command_expired_at',
    'worker_command_expiry_reason',
  ]) {
    delete message[field];
  }
  return message as WorkerCommandJsonObject;
}
