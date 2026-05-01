import { EMessageType } from '@core/common/enums/EMessageType';
import {
  classifyChatbotTriggerEvent,
  isChatbotTriggerEventEnabled,
} from '@core/common/functions/chatbotTriggerEvents';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';

function buildUpsertMessage(
  type: EMessageType,
  options?: {
    fromMe?: boolean;
    message?: Record<string, unknown>;
    content?: IUpsertMessage['content'];
  }
): IUpsertMessage {
  return {
    worker_id: 'worker-1',
    account_id: 'account-1',
    type,
    has_quoted: false,
    content: options?.content,
    message: {
      key: {
        fromMe: options?.fromMe ?? false,
      },
      message: options?.message ?? {},
    },
  };
}

describe('chatbotTriggerEvents', () => {
  it('classifies text, audio and reaction events', () => {
    expect(
      classifyChatbotTriggerEvent(buildUpsertMessage(EMessageType.text))
    ).toBe('text');
    expect(
      classifyChatbotTriggerEvent(buildUpsertMessage(EMessageType.audio))
    ).toBe('audio');
    expect(
      classifyChatbotTriggerEvent(buildUpsertMessage(EMessageType.react))
    ).toBe('reactions');
  });

  it('classifies emoji-only text messages as gifs events', () => {
    const emojiOnlyMessages = ['🤣', '👍🏽', '👨‍👩‍👧‍👦'];

    for (const emojiOnlyMessage of emojiOnlyMessages) {
      const data = buildUpsertMessage(EMessageType.text, {
        message: {
          conversation: emojiOnlyMessage,
        },
      });

      expect(classifyChatbotTriggerEvent(data)).toBe('gifs');
    }
  });

  it('keeps mixed text messages as text events', () => {
    const mixedMessages = ['oi 🤣', '123', 'ok'];

    for (const mixedMessage of mixedMessages) {
      const data = buildUpsertMessage(EMessageType.text, {
        message: {
          conversation: mixedMessage,
        },
      });

      expect(classifyChatbotTriggerEvent(data)).toBe('text');
    }
  });

  it('classifies stickers as gifs events', () => {
    expect(
      classifyChatbotTriggerEvent(buildUpsertMessage(EMessageType.sticker))
    ).toBe('gifs');
  });

  it('classifies gif image by mimetype', () => {
    const data = buildUpsertMessage(EMessageType.image, {
      message: {
        imageMessage: {
          mimetype: 'image/gif',
        },
      },
    });

    expect(classifyChatbotTriggerEvent(data)).toBe('gifs');
  });

  it('classifies gif video by gifPlayback flag', () => {
    const data = buildUpsertMessage(EMessageType.video, {
      message: {
        videoMessage: {
          mimetype: 'video/mp4',
          gifPlayback: true,
        },
      },
    });

    expect(classifyChatbotTriggerEvent(data)).toBe('gifs');
  });

  it('classifies gif video by mimetype fallback', () => {
    const data = buildUpsertMessage(EMessageType.video, {
      message: {
        videoMessage: {
          mimetype: 'image/gif',
        },
      },
    });

    expect(classifyChatbotTriggerEvent(data)).toBe('gifs');
  });

  it('classifies gif view once payloads as gifs', () => {
    const data = buildUpsertMessage(EMessageType.view_once, {
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: {
              mimetype: 'image/gif',
            },
          },
        },
      },
    });

    expect(classifyChatbotTriggerEvent(data)).toBe('gifs');
  });

  it('classifies supported attachment events', () => {
    const attachmentTypes: EMessageType[] = [
      EMessageType.image,
      EMessageType.video,
      EMessageType.video_note,
      EMessageType.document,
      EMessageType.location,
      EMessageType.contact_card,
      EMessageType.contacts,
      EMessageType.view_once,
    ];

    for (const type of attachmentTypes) {
      expect(classifyChatbotTriggerEvent(buildUpsertMessage(type))).toBe(
        'attachments'
      );
    }
  });

  it('returns null for non-triggerable control types', () => {
    const controlTypes: EMessageType[] = [
      EMessageType.edit_text,
      EMessageType.delete_message,
      EMessageType.system,
      EMessageType.set_disappearing_messages,
      EMessageType.annotation,
    ];

    for (const type of controlTypes) {
      expect(classifyChatbotTriggerEvent(buildUpsertMessage(type))).toBeNull();
    }
  });

  it('checks trigger event enablement with defaults and explicit config', () => {
    expect(isChatbotTriggerEventEnabled('text', undefined)).toBe(true);
    expect(isChatbotTriggerEventEnabled('audio', [])).toBe(false);
    expect(isChatbotTriggerEventEnabled('attachments', ['attachments'])).toBe(
      true
    );
    expect(isChatbotTriggerEventEnabled('reactions', ['text', 'audio'])).toBe(
      false
    );
    expect(isChatbotTriggerEventEnabled(null, ['text'])).toBe(false);
  });

  it('respects gifs toggle for emoji-only text events', () => {
    const data = buildUpsertMessage(EMessageType.text, {
      message: {
        conversation: '🤣',
      },
    });

    const triggerEvent = classifyChatbotTriggerEvent(data);
    expect(triggerEvent).toBe('gifs');
    expect(isChatbotTriggerEventEnabled(triggerEvent, ['text'])).toBe(false);
    expect(isChatbotTriggerEventEnabled(triggerEvent, ['gifs'])).toBe(true);
  });
});
