import 'reflect-metadata';
import { account, user, userInfo } from '@core/models';
import { PublicApiTokenRepository } from '@core/repositories/publicApiToken/PublicApiToken.repository';

describe('PublicApiTokenRepository authentication contract', () => {
  it('authenticates by token account without requiring the creator to exist or remain active', async () => {
    const authenticatedToken = {
      public_api_token_id: '01900000-0000-7000-8000-000000000001',
      account_id: '01900000-0000-7000-8000-000000000002',
      actor_user_id: '01900000-0000-7000-8000-000000000003',
      actor_user_name: null,
      token_hash: 'a'.repeat(64),
      token_encrypted: 'encrypted',
      token_preview: 'uc_live_...aaaaaaaa',
      created_at: '2026-07-10T12:00:00.000Z',
      updated_at: '2026-07-10T12:00:00.000Z',
      rotated_at: null,
      last_used_at: null,
      revoked_at: null,
      plan_is_active: true,
    };
    const query = {
      from: jest.fn(),
      leftJoin: jest.fn(),
      innerJoin: jest.fn(),
      where: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn(async () => [authenticatedToken]),
    };
    query.from.mockReturnValue(query);
    query.leftJoin.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const database = {
      select: jest.fn(() => query),
    };
    const repository = new PublicApiTokenRepository(database as never);

    await expect(
      repository.findActiveByHash(authenticatedToken.token_hash)
    ).resolves.toEqual(authenticatedToken);

    expect(query.leftJoin).toHaveBeenCalledWith(userInfo, expect.anything());
    expect(query.innerJoin).toHaveBeenCalledWith(account, expect.anything());
    expect(query.innerJoin.mock.calls.map(([table]) => table)).not.toContain(
      user
    );
  });
});
