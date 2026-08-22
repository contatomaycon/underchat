export class MessageUpdatePublishFailedError extends Error {
  readonly kind = 'message_update_publish_failed' as const;
  readonly originalCause: unknown;

  constructor(cause: unknown) {
    super('message_update_publish_failed');
    this.name = 'MessageUpdatePublishFailedError';
    this.originalCause = cause;
  }
}

export function isMessageUpdatePublishFailedError(
  error: unknown
): error is MessageUpdatePublishFailedError {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'MessageUpdatePublishFailedError' ||
    (error as Partial<MessageUpdatePublishFailedError>).kind ===
      'message_update_publish_failed'
  );
}
