import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_MOBILE_CHAT_NOTIFICATION_SETTINGS,
  DEFAULT_MOBILE_INTERNAL_CHAT_NOTIFICATION_SETTINGS,
  resolveChatForegroundDelivery,
  resolveInternalChatForegroundDelivery,
  shouldNotifyChatMessage,
  shouldNotifyChatTransfer,
  shouldNotifyInternalChatMessage,
} from '../utils/mobileNotificationPreferences';
import { INTERNAL_CHAT_CONVERSATION_TYPE } from '../types/internalChat';

describe('mobile notification preferences', () => {
  it('does not use the browser chat preference for mobile foreground delivery', () => {
    const settings = {
      ...DEFAULT_MOBILE_CHAT_NOTIFICATION_SETTINGS,
      notifications_browser: false,
    };

    expect(shouldNotifyChatMessage(settings, 'in_chat')).toBe(true);
    expect(shouldNotifyChatTransfer(settings)).toBe(true);
    expect(resolveChatForegroundDelivery(settings)).toEqual({
      showToast: true,
      playSound: true,
    });
  });

  it('blocks all chat foreground delivery when the chat master toggle is off', () => {
    const settings = {
      ...DEFAULT_MOBILE_CHAT_NOTIFICATION_SETTINGS,
      notifications: false,
      notifications_message_queue: true,
    };

    expect(shouldNotifyChatMessage(settings, 'queue')).toBe(false);
    expect(shouldNotifyChatTransfer(settings)).toBe(false);
    expect(resolveChatForegroundDelivery(settings)).toEqual({
      showToast: false,
      playSound: false,
    });
  });

  it('respects chat message rules by attendance status', () => {
    const settings = {
      ...DEFAULT_MOBILE_CHAT_NOTIFICATION_SETTINGS,
      notifications_message_queue: true,
      notifications_message_chatbot: true,
    };

    expect(shouldNotifyChatMessage(settings, 'queue')).toBe(true);
    expect(shouldNotifyChatMessage(settings, 'in_chat')).toBe(true);
    expect(shouldNotifyChatMessage(settings, 'ura')).toBe(true);
    expect(shouldNotifyChatMessage(settings, 'closed')).toBe(false);
  });

  it('does not use the browser internal chat preference for mobile foreground delivery', () => {
    const settings = {
      ...DEFAULT_MOBILE_INTERNAL_CHAT_NOTIFICATION_SETTINGS,
      notifications_internal_chat_browser: false,
    };

    expect(
      shouldNotifyInternalChatMessage(
        settings,
        INTERNAL_CHAT_CONVERSATION_TYPE.direct
      )
    ).toBe(true);
    expect(resolveInternalChatForegroundDelivery(settings)).toEqual({
      showToast: true,
      playSound: true,
    });
  });

  it('blocks internal chat delivery from the master toggle and respects direct/group toggles', () => {
    const disabled = {
      ...DEFAULT_MOBILE_INTERNAL_CHAT_NOTIFICATION_SETTINGS,
      notifications_internal_chat: false,
    };
    const groupOnly = {
      ...DEFAULT_MOBILE_INTERNAL_CHAT_NOTIFICATION_SETTINGS,
      notifications_internal_chat_direct: false,
      notifications_internal_chat_group: true,
    };

    expect(
      shouldNotifyInternalChatMessage(
        disabled,
        INTERNAL_CHAT_CONVERSATION_TYPE.group
      )
    ).toBe(false);
    expect(resolveInternalChatForegroundDelivery(disabled)).toEqual({
      showToast: false,
      playSound: false,
    });
    expect(
      shouldNotifyInternalChatMessage(
        groupOnly,
        INTERNAL_CHAT_CONVERSATION_TYPE.direct
      )
    ).toBe(false);
    expect(
      shouldNotifyInternalChatMessage(
        groupOnly,
        INTERNAL_CHAT_CONVERSATION_TYPE.group
      )
    ).toBe(true);
  });
});
