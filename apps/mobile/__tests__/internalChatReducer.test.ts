import { describe, expect, it } from '@jest/globals';
import {
  createInitialInternalChatState,
  getInternalChatTotalUnread,
  internalChatReducer,
} from '../context/internalChatReducer';
import type {
  InternalChatConversation,
  InternalChatMessage,
} from '../types/internalChat';

function buildConversation(
  overrides: Partial<InternalChatConversation> = {}
): InternalChatConversation {
  return {
    conversation_id: 'conversation-1',
    account_id: 'account-1',
    type: 'direct',
    name: null,
    photo: null,
    leader_user_id: null,
    last_message_id: null,
    last_message_preview: null,
    last_message_at: null,
    unread_count: 0,
    is_closed_for_me: false,
    participants: [],
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function buildMessage(
  overrides: Partial<InternalChatMessage> = {}
): InternalChatMessage {
  return {
    message_id: 'message-1',
    conversation_id: 'conversation-1',
    account_id: 'account-1',
    type_user: 'operator',
    user: {
      id: 'user-2',
      name: 'Other',
      photo: null,
    },
    content: {
      type: 'text',
      message: 'Oi',
    },
    date: '2026-01-01T10:01:00.000Z',
    ...overrides,
  };
}

describe('internalChatReducer', () => {
  it('loads and appends conversations with unread totals', () => {
    let state = createInitialInternalChatState();
    state = internalChatReducer(state, {
      type: 'setConversations',
      append: false,
      payload: {
        results: [
          buildConversation({
            conversation_id: 'conversation-1',
            unread_count: 2,
          }),
        ],
        current_page: 1,
        total_pages: 2,
        per_page: 20,
        count: 1,
        total: 2,
      },
    });
    state = internalChatReducer(state, {
      type: 'setConversations',
      append: true,
      payload: {
        results: [
          buildConversation({
            conversation_id: 'conversation-2',
            unread_count: 3,
            updated_at: '2026-01-01T10:02:00.000Z',
          }),
        ],
        current_page: 2,
        total_pages: 2,
        per_page: 20,
        count: 1,
        total: 2,
      },
    });

    expect(state.conversations).toHaveLength(2);
    expect(getInternalChatTotalUnread(state)).toBe(5);
  });

  it('increments unread on realtime message outside active conversation', () => {
    let state = createInitialInternalChatState();
    state = internalChatReducer(state, {
      type: 'setConversations',
      append: false,
      payload: {
        results: [buildConversation()],
        current_page: 1,
        total_pages: 1,
        per_page: 20,
        count: 1,
        total: 1,
      },
    });

    state = internalChatReducer(state, {
      type: 'upsertMessage',
      message: buildMessage(),
      currentUserId: 'user-1',
    });

    expect(state.conversations[0]?.unread_count).toBe(1);
    expect(state.conversations[0]?.last_message_preview).toBe('Oi');
    expect(state.messages['conversation-1']).toHaveLength(1);
  });

  it('does not increment unread for active conversation and markRead clears it', () => {
    let state = createInitialInternalChatState();
    const conversation = buildConversation({ unread_count: 4 });
    state = internalChatReducer(state, {
      type: 'setConversations',
      append: false,
      payload: {
        results: [conversation],
        current_page: 1,
        total_pages: 1,
        per_page: 20,
        count: 1,
        total: 1,
      },
    });
    state = internalChatReducer(state, {
      type: 'setActiveConversation',
      conversation,
    });
    state = internalChatReducer(state, {
      type: 'upsertMessage',
      message: buildMessage(),
      currentUserId: 'user-1',
    });
    state = internalChatReducer(state, {
      type: 'markRead',
      conversationId: 'conversation-1',
    });

    expect(state.conversations[0]?.unread_count).toBe(0);
    expect(state.activeConversation?.unread_count).toBe(0);
  });

  it('stores and clears typing or recording activity', () => {
    let state = createInitialInternalChatState();
    state = internalChatReducer(state, {
      type: 'setRemoteActivity',
      activity: {
        conversation_id: 'conversation-1',
        user_id: 'user-2',
        user_name: 'Other',
        user_photo: null,
        state: 'typing',
        expires_at: Date.now() + 5000,
      },
    });

    expect(state.remoteActivities['conversation-1:user-2']?.state).toBe(
      'typing'
    );

    state = internalChatReducer(state, {
      type: 'clearRemoteActivity',
      conversationId: 'conversation-1',
      userId: 'user-2',
    });

    expect(state.remoteActivities['conversation-1:user-2']).toBeUndefined();
  });

  it('stores, updates, marks error, and clears upload state by hash', () => {
    let state = createInitialInternalChatState();

    state = internalChatReducer(state, {
      type: 'setUploadState',
      hash: 'hash-1',
      uploadState: { status: 'uploading', progress: 0 },
    });
    expect(state.uploadStates['hash-1']).toEqual({
      status: 'uploading',
      progress: 0,
    });

    state = internalChatReducer(state, {
      type: 'setUploadState',
      hash: 'hash-1',
      uploadState: { status: 'uploading', progress: 42 },
    });
    expect(state.uploadStates['hash-1']?.progress).toBe(42);

    state = internalChatReducer(state, {
      type: 'setUploadState',
      hash: 'hash-1',
      uploadState: {
        status: 'error',
        progress: 42,
        errorMessage: 'Falha ao enviar.',
      },
    });
    expect(state.uploadStates['hash-1']).toEqual({
      status: 'error',
      progress: 42,
      errorMessage: 'Falha ao enviar.',
    });

    state = internalChatReducer(state, {
      type: 'clearUploadState',
      hash: 'hash-1',
    });
    expect(state.uploadStates['hash-1']).toBeUndefined();
  });

  it('keeps upload state for local placeholders and clears it for remote hash matches', () => {
    let state = createInitialInternalChatState();
    state = internalChatReducer(state, {
      type: 'setUploadState',
      hash: 'hash-1',
      uploadState: { status: 'uploading', progress: 68 },
    });

    state = internalChatReducer(state, {
      type: 'upsertMessage',
      message: buildMessage({
        message_id: 'local-hash-1',
        hash: 'hash-1',
        local_status: 'sending',
      }),
      currentUserId: 'user-2',
    });
    expect(state.uploadStates['hash-1']?.progress).toBe(68);

    state = internalChatReducer(state, {
      type: 'upsertMessage',
      message: buildMessage({
        message_id: 'remote-message-1',
        hash: 'hash-1',
      }),
      currentUserId: 'user-2',
    });
    expect(state.uploadStates['hash-1']).toBeUndefined();
  });
});
