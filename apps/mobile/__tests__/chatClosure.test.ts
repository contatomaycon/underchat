import { describe, expect, it } from '@jest/globals';
import {
  CLOSURE_COMMENT_REQUIRED_REASON,
  buildCloseChatPatchOptions,
  isClosureCommentRequiredFailure,
  shouldShowClosureReasonInput,
} from '../utils/chatClosure';

describe('chatClosure helpers', () => {
  it('requires a closure comment when the user cannot toggle the reason', () => {
    const result = buildCloseChatPatchOptions({
      canToggleOptionalClosureReason: false,
      informClosureReason: false,
      closureComment: '',
      includeSendMessageOnFinishAttendance: false,
      sendMessageOnFinishAttendance: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: CLOSURE_COMMENT_REQUIRED_REASON,
    });
  });

  it('omits closure comment when the optional toggle is off', () => {
    const result = buildCloseChatPatchOptions({
      canToggleOptionalClosureReason: true,
      informClosureReason: false,
      closureComment: '  ',
      includeSendMessageOnFinishAttendance: true,
      sendMessageOnFinishAttendance: false,
    });

    expect(result).toEqual({
      ok: true,
      options: {
        send_message_on_finish_attendance: false,
      },
    });
  });

  it('includes a trimmed closure comment when required by backend', () => {
    const result = buildCloseChatPatchOptions({
      canToggleOptionalClosureReason: true,
      informClosureReason: false,
      backendRequiresClosureReason: true,
      closureComment: '  Cliente pediu encerramento. ',
      includeSendMessageOnFinishAttendance: false,
      sendMessageOnFinishAttendance: true,
    });

    expect(result).toEqual({
      ok: true,
      options: {
        closure_comment: 'Cliente pediu encerramento.',
      },
    });
  });

  it('shows the closure input when local state or backend requires it', () => {
    expect(
      shouldShowClosureReasonInput({
        canToggleOptionalClosureReason: true,
        informClosureReason: false,
      })
    ).toBe(false);

    expect(
      shouldShowClosureReasonInput({
        canToggleOptionalClosureReason: true,
        informClosureReason: false,
        backendRequiresClosureReason: true,
      })
    ).toBe(true);
  });

  it('detects closure-comment failures by reason or compatibility message', () => {
    expect(
      isClosureCommentRequiredFailure({
        reason: CLOSURE_COMMENT_REQUIRED_REASON,
      })
    ).toBe(true);

    expect(
      isClosureCommentRequiredFailure({
        message: 'Informe o motivo do encerramento.',
        expectedMessage: 'Informe o motivo do encerramento.',
      })
    ).toBe(true);
  });
});
