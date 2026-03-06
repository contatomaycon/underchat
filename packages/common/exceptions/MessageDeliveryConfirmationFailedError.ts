export class MessageDeliveryConfirmationFailedError extends Error {
  readonly kind = 'message_delivery_confirmation_failed' as const;
  readonly maxAttempts: number;
  readonly lastMessageId?: string;
  readonly lastOutcome: 'failed' | 'timeout';
  readonly originalCause?: unknown;

  constructor(input: {
    message?: string;
    maxAttempts: number;
    lastMessageId?: string;
    lastOutcome: 'failed' | 'timeout';
    cause?: unknown;
  }) {
    super(
      input.message ??
        `Message delivery was not confirmed after ${input.maxAttempts} attempts`
    );
    this.name = 'MessageDeliveryConfirmationFailedError';
    this.maxAttempts = input.maxAttempts;
    this.lastMessageId = input.lastMessageId;
    this.lastOutcome = input.lastOutcome;
    this.originalCause = input.cause;
  }
}

export function isMessageDeliveryConfirmationFailedError(
  error: unknown
): error is MessageDeliveryConfirmationFailedError {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'MessageDeliveryConfirmationFailedError' ||
    (error as Partial<MessageDeliveryConfirmationFailedError>).kind ===
      'message_delivery_confirmation_failed'
  );
}
