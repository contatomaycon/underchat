import 'reflect-metadata';
import {
  generatePublicApiTokenValue,
  hashPublicApiToken,
  isPublicApiTokenFormat,
  previewPublicApiToken,
  PublicApiTokenService,
} from '@core/services/publicApiToken.service';
import { PublicApiTokenRecord } from '@core/repositories/publicApiToken/PublicApiToken.repository';

const activeRecord: PublicApiTokenRecord = {
  public_api_token_id: '01900000-0000-7000-8000-000000000001',
  account_id: '01900000-0000-7000-8000-000000000002',
  actor_user_id: '01900000-0000-7000-8000-000000000003',
  actor_user_name: 'Ada Lovelace',
  token_hash: 'hash',
  token_encrypted: 'encrypted-token',
  token_preview: 'uc_live_...12345678',
  created_at: '2026-07-10T12:00:00.000Z',
  updated_at: '2026-07-10T12:00:00.000Z',
  rotated_at: null,
  last_used_at: null,
  revoked_at: null,
};

describe('PublicApiTokenService contract', () => {
  it('generates a 256-bit prefixed token, hash and safe preview', () => {
    const token = generatePublicApiTokenValue();

    expect(token).toMatch(/^uc_live_[A-Za-z0-9_-]{43}$/);
    expect(isPublicApiTokenFormat(token)).toBe(true);
    expect(hashPublicApiToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(previewPublicApiToken(token)).toBe(`uc_live_...${token.slice(-8)}`);
    expect(previewPublicApiToken(token)).not.toContain(token);
  });

  it('returns the retrievable decrypted active token', async () => {
    const repository = {
      findActiveByAccount: jest.fn(async () => activeRecord),
    };
    const encryptor = {
      decrypt: jest.fn(() => 'uc_live_decrypted'),
    };
    const service = new PublicApiTokenService(
      repository as never,
      encryptor as never
    );

    await expect(service.view(activeRecord.account_id)).resolves.toEqual({
      configured: true,
      token_id: activeRecord.public_api_token_id,
      status: 'active',
      token: 'uc_live_decrypted',
      token_preview: activeRecord.token_preview,
      actor_user_id: activeRecord.actor_user_id,
      actor_user_name: activeRecord.actor_user_name,
      created_at: activeRecord.created_at,
      updated_at: activeRecord.updated_at,
      rotated_at: null,
      last_used_at: null,
      revoked_at: null,
    });
    expect(encryptor.decrypt).toHaveBeenCalledWith('encrypted-token');
  });

  it('does not create tokens implicitly when none is configured', async () => {
    const repository = {
      findActiveByAccount: jest.fn(async () => null),
    };
    const service = new PublicApiTokenService(
      repository as never,
      { decrypt: jest.fn() } as never
    );

    await expect(service.view(activeRecord.account_id)).resolves.toEqual({
      configured: false,
      token_id: null,
      status: 'not_configured',
      token: null,
      token_preview: null,
      actor_user_id: null,
      actor_user_name: null,
      created_at: null,
      updated_at: null,
      rotated_at: null,
      last_used_at: null,
      revoked_at: null,
    });
  });

  it('stores only the hash and AES-GCM output during generation', async () => {
    const rotate = jest.fn(async (input) => ({
      ...activeRecord,
      public_api_token_id: input.public_api_token_id,
      token_hash: input.token_hash,
      token_encrypted: input.token_encrypted,
      token_preview: input.token_preview,
    }));
    const encrypt = jest.fn((value: string) => `aes-gcm:${value.length}`);
    const service = new PublicApiTokenService(
      { rotate } as never,
      { encrypt } as never
    );

    const response = await service.generate(
      activeRecord.account_id,
      activeRecord.actor_user_id
    );
    const plainToken = response.token;

    expect(plainToken).toEqual(expect.stringMatching(/^uc_live_/));
    expect(encrypt).toHaveBeenCalledWith(plainToken);
    expect(rotate).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: activeRecord.account_id,
        actor_user_id: activeRecord.actor_user_id,
        token_hash: hashPublicApiToken(plainToken as string),
        token_encrypted: `aes-gcm:${plainToken?.length}`,
        token_preview: previewPublicApiToken(plainToken as string),
      })
    );
  });

  it('never decrypts or returns a revoked token', async () => {
    const revokedRecord = {
      ...activeRecord,
      revoked_at: '2026-07-10T13:00:00.000Z',
      updated_at: '2026-07-10T13:00:00.000Z',
    };
    const service = new PublicApiTokenService(
      { revoke: jest.fn(async () => revokedRecord) } as never,
      { decrypt: jest.fn() } as never
    );

    await expect(service.revoke(activeRecord.account_id)).resolves.toEqual(
      expect.objectContaining({
        configured: false,
        status: 'revoked',
        token: null,
        revoked_at: revokedRecord.revoked_at,
      })
    );
  });
});
