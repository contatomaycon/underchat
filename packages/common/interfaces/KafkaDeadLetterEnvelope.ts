export interface KafkaDeadLetterEnvelope<TPayload = unknown> {
  source_topic: string;
  source_group_id: string;
  partition: number;
  offset: number;
  kafka_key: string | null;
  payload: TPayload;
  error: string;
  failed_at: string;
  attempts: number;
  reason: string;
}
