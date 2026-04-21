import 'reflect-metadata';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatUserViewerRepository', () => {
  it('returns null when user config is not found', async () => {
    const chain = createSelectChain([]);
    const dbRo = { select: chain.select };
    const redis = { scan: jest.fn(), get: jest.fn() };
    const presenceService = { getStatus: jest.fn() };
    const repository = new ChatUserViewerRepository(
      dbRo as never,
      redis as never,
      presenceService as never
    );

    await expect(repository.viewChatUser('user-1')).resolves.toBeNull();
  });

  it('returns mapped config with presence status', async () => {
    const chain = createSelectChain([
      {
        chat_user_id: 'cu-1',
        about: 'about',
        notifications: true,
        notifications_sound: true,
        notifications_toast: true,
        notifications_browser: true,
        notifications_push: true,
        notifications_status_update: true,
        notifications_status_queue: false,
        notifications_status_in_chat: true,
        notifications_status_chatbot: false,
        sort_by_chat_order: null,
        sort_in_chat_order: null,
        sort_by_my_chats_order: null,
        sort_my_chats_order: null,
        sort_by_queue_order: null,
        sort_queue_order: null,
        sort_by_chatbot_order: null,
        sort_chatbot_order: null,
      },
    ]);
    const dbRo = { select: chain.select };
    const redis = { scan: jest.fn(), get: jest.fn() };
    const presenceService = {
      getStatus: jest.fn(async () => EChatUserStatus.online),
    };
    const repository = new ChatUserViewerRepository(
      dbRo as never,
      redis as never,
      presenceService as never
    );

    await expect(repository.viewChatUser('user-1')).resolves.toEqual(
      expect.objectContaining({
        chat_user_id: 'cu-1',
        status: EChatUserStatus.online,
      })
    );
  });

  it('findStatusByUserId delegates to presence service', async () => {
    const chain = createSelectChain([]);
    const dbRo = { select: chain.select };
    const redis = { scan: jest.fn(), get: jest.fn() };
    const presenceService = {
      getStatus: jest.fn(async () => EChatUserStatus.away),
    };
    const repository = new ChatUserViewerRepository(
      dbRo as never,
      redis as never,
      presenceService as never
    );

    await expect(repository.findStatusByUserId('user-1')).resolves.toBe(
      EChatUserStatus.away
    );
  });

  it('listUserIdsByStatuses returns empty when filter is empty', async () => {
    const chain = createSelectChain([]);
    const dbRo = { select: chain.select };
    const redis = { scan: jest.fn(), get: jest.fn() };
    const presenceService = { getStatus: jest.fn() };
    const repository = new ChatUserViewerRepository(
      dbRo as never,
      redis as never,
      presenceService as never
    );

    await expect(repository.listUserIdsByStatuses([])).resolves.toEqual([]);
  });

  it('listUserIdsByStatuses scans redis and filters statuses', async () => {
    const chain = createSelectChain([]);
    const dbRo = { select: chain.select };
    const redis = {
      scan: jest
        .fn()
        .mockResolvedValueOnce(['1', ['presence:user:u1', 'presence:user:u2']])
        .mockResolvedValueOnce(['0', ['presence:user:u3']]),
      get: jest
        .fn()
        .mockResolvedValueOnce(EChatUserStatus.online)
        .mockResolvedValueOnce(EChatUserStatus.offline)
        .mockResolvedValueOnce(EChatUserStatus.online),
    };
    const presenceService = { getStatus: jest.fn() };
    const repository = new ChatUserViewerRepository(
      dbRo as never,
      redis as never,
      presenceService as never
    );

    await expect(
      repository.listUserIdsByStatuses([EChatUserStatus.online])
    ).resolves.toEqual(['u1', 'u3']);
  });
});
