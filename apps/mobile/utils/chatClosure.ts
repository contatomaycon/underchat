export const CLOSURE_COMMENT_REQUIRED_REASON = 'closure_comment_required';

export type ClosureCommentRequiredReason =
  typeof CLOSURE_COMMENT_REQUIRED_REASON;

export type CloseChatPatchOptions = {
  send_message_on_finish_attendance?: boolean;
  closure_comment?: string;
};

type ClosureReasonState = {
  canToggleOptionalClosureReason: boolean;
  informClosureReason: boolean;
  backendRequiresClosureReason?: boolean;
};

export function shouldShowClosureReasonInput({
  canToggleOptionalClosureReason,
  informClosureReason,
  backendRequiresClosureReason = false,
}: ClosureReasonState): boolean {
  return (
    backendRequiresClosureReason ||
    !canToggleOptionalClosureReason ||
    informClosureReason
  );
}

export function isClosureReasonRequired({
  canToggleOptionalClosureReason,
  informClosureReason,
  backendRequiresClosureReason = false,
}: ClosureReasonState): boolean {
  return shouldShowClosureReasonInput({
    canToggleOptionalClosureReason,
    informClosureReason,
    backendRequiresClosureReason,
  });
}

export function buildCloseChatPatchOptions(input: {
  canToggleOptionalClosureReason: boolean;
  informClosureReason: boolean;
  backendRequiresClosureReason?: boolean;
  closureComment: string;
  includeSendMessageOnFinishAttendance: boolean;
  sendMessageOnFinishAttendance: boolean;
}):
  | {
      ok: true;
      options: CloseChatPatchOptions | undefined;
    }
  | {
      ok: false;
      reason: ClosureCommentRequiredReason;
    } {
  const trimmedClosure = input.closureComment.trim();
  const closureReasonRequired = isClosureReasonRequired(input);

  if (closureReasonRequired && !trimmedClosure) {
    return {
      ok: false,
      reason: CLOSURE_COMMENT_REQUIRED_REASON,
    };
  }

  const options: CloseChatPatchOptions = {};

  if (input.includeSendMessageOnFinishAttendance) {
    options.send_message_on_finish_attendance =
      input.sendMessageOnFinishAttendance;
  }

  if (closureReasonRequired && trimmedClosure) {
    options.closure_comment = trimmedClosure;
  }

  return {
    ok: true,
    options: Object.keys(options).length > 0 ? options : undefined,
  };
}

export function isClosureCommentRequiredFailure(input: {
  reason?: string | null;
  message?: string | null;
  expectedMessage?: string | null;
}): boolean {
  if (input.reason === CLOSURE_COMMENT_REQUIRED_REASON) return true;

  const message = input.message?.trim();
  const expectedMessage = input.expectedMessage?.trim();
  return !!message && !!expectedMessage && message === expectedMessage;
}
