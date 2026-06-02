import { describe, expect, it, beforeEach, jest } from '@jest/globals';

const mockStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

jest.mock('@react-native-async-storage/async-storage', () => mockStorage);
jest.mock('../config', () => ({ BACKEND_URL: 'https://api.test' }));

const fetchMock = jest.fn();

global.fetch = fetchMock as never;

function buildSessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      user_id: 'user-1',
      account_id: 'account-1',
    },
    token: 'new-token',
    permissions: ['chat_access'],
    layout: null,
    sectors: ['sector-1'],
    channels: [{ id: 'worker-1', name: 'Canal 1' }],
    plan_is_active: true,
    plan_products: ['867d1856-74f6-4e5d-a932-88c723af499d'],
    attendance_guard: {
      is_blocked_now: false,
      server_now: '2026-01-01T00:00:00.000Z',
      next_transition_at: null,
      today_windows_label: null,
      today_windows: [],
    },
    ...overrides,
  };
}

function response(
  status: number,
  body: unknown
): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('mobile sessionRefresh', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStorage.getItem.mockReset();
    mockStorage.setItem.mockReset();
    mockStorage.removeItem.mockReset();
    fetchMock.mockReset();
  });

  it('persists the complete refreshed session snapshot', async () => {
    mockStorage.getItem.mockResolvedValue('old-token' as never);
    fetchMock.mockResolvedValue(
      response(200, {
        status: true,
        data: buildSessionPayload(),
      }) as never
    );

    const { refreshSessionWithSingleFlight } =
      await import('../api/sessionRefresh');

    const result = await refreshSessionWithSingleFlight();

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/auth/refresh-token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer old-token',
          'X-Client-Platform': 'mobile',
        }),
      })
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_token',
      'new-token'
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_permissions',
      JSON.stringify(['chat_access'])
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_channels',
      JSON.stringify([{ id: 'worker-1', name: 'Canal 1' }])
    );
    expect(mockStorage.setItem).toHaveBeenCalledWith(
      '@underchat_plan_products',
      JSON.stringify(['867d1856-74f6-4e5d-a932-88c723af499d'])
    );
  });

  it('returns unauthorized without persisting on 401', async () => {
    mockStorage.getItem.mockResolvedValue('old-token' as never);
    fetchMock.mockResolvedValue(
      response(401, {
        status: false,
        message: 'invalid_token',
        data: null,
      }) as never
    );

    const { refreshSessionWithSingleFlight } =
      await import('../api/sessionRefresh');

    const result = await refreshSessionWithSingleFlight();

    expect(result).toEqual({
      success: false,
      reason: 'unauthorized',
      message: 'invalid_token',
    });
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });

  it('returns network_error without clearing the cached session', async () => {
    mockStorage.getItem.mockResolvedValue('old-token' as never);
    fetchMock.mockRejectedValue(new Error('offline') as never);

    const { refreshSessionWithSingleFlight } =
      await import('../api/sessionRefresh');

    const result = await refreshSessionWithSingleFlight();

    expect(result).toEqual({
      success: false,
      reason: 'network_error',
      message: null,
    });
    expect(mockStorage.removeItem).not.toHaveBeenCalled();
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });
});
