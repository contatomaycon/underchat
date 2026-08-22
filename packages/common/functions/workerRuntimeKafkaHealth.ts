export interface WorkerRuntimeKafkaHealthState {
  kafkaUnhealthy: boolean;
  kafkaConsumersReady: boolean;
}

export function resolveWorkerRuntimeKafkaHealthState(input: {
  standby: boolean;
  activated: boolean;
  kafkaUnhealthy: boolean;
}): WorkerRuntimeKafkaHealthState {
  /*
   * Warm standbys intentionally do not start the channel Kafka consumers.
   * Missing consumers are therefore "not applicable", not an unhealthy
   * runtime. The strict Kafka gate becomes active immediately after cutover.
   */
  const kafkaHealthApplicable = input.activated && !input.standby;
  const kafkaUnhealthy = kafkaHealthApplicable && input.kafkaUnhealthy;

  return {
    kafkaUnhealthy,
    kafkaConsumersReady: kafkaHealthApplicable && !kafkaUnhealthy,
  };
}
