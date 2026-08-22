export class ScheduleMessageSendAmbiguousError extends Error {
  readonly kind = 'schedule_message_send_ambiguous' as const;
  readonly originalCause: unknown;

  constructor(cause: unknown) {
    super('schedule_message_send_ambiguous');
    this.name = 'ScheduleMessageSendAmbiguousError';
    this.originalCause = cause;
  }
}

export function isScheduleMessageSendAmbiguousError(
  error: unknown
): error is ScheduleMessageSendAmbiguousError {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'ScheduleMessageSendAmbiguousError' ||
    (error as Partial<ScheduleMessageSendAmbiguousError>).kind ===
      'schedule_message_send_ambiguous'
  );
}
