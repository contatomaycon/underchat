import 'reflect-metadata';

import { ChatbotUnderchatUserLookupService } from '@core/services/chatbotUnderchatUserLookup.service';

const createHarness = () => {
  const repository = {
    findNewestUser: jest.fn(
      async (): Promise<{
        userId: string;
        accountId: string;
        accountName: string;
        encryptedEmail: string;
        userStatus: string;
        accountStatus: string;
      } | null> => ({
        userId: 'user-1',
        accountId: 'account-vasco',
        accountName: 'Vasco',
        encryptedEmail: 'email:cipher:tag',
        userStatus: 'active',
        accountStatus: 'active',
      })
    ),
    findLatestUserInfo: jest.fn(async () => ({
      name: 'Maria',
      lastName: 'Silva',
      phoneDdi: '+55',
      encryptedPhone: 'phone:cipher:tag',
    })),
    findLatestDocument: jest.fn(async () => 'document:cipher:tag'),
    findAccessGroup: jest.fn(async () => 'Administradores'),
    listSectors: jest.fn(async () => ['Comercial', 'Suporte']),
    listChannels: jest.fn(async (): Promise<string[]> => []),
    listAllAccountChannels: jest.fn(async () => ['WhatsApp', 'Instagram']),
    findCurrentOrRecentPlan: jest.fn(async () => ({
      planName: 'Pro',
      billingPeriod: 'monthly',
      nextPaymentAt: '2999-08-13T03:00:00.000Z',
    })),
    findLatestPaidPayment: jest.fn(async () => ({
      paidAt: '2026-07-13T09:00:00-03:00',
      amount: '149.90',
    })),
  };
  const encryptService = {
    encrypt: jest.fn((value: string) => `hash:${value}`),
  };
  const decryptedValues: Record<string, string> = {
    'email:cipher:tag': 'maria@example.com',
    'phone:cipher:tag': '(11) 99999-9999',
    'document:cipher:tag': '529.982.247-25',
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => decryptedValues[value] ?? ''),
  };

  return {
    repository,
    encryptService,
    passwordEncryptorService,
    service: new ChatbotUnderchatUserLookupService(
      repository as never,
      encryptService as never,
      passwordEncryptorService as never
    ),
  };
};

describe('ChatbotUnderchatUserLookupService', () => {
  it('searches globally and aggregates data from the matched user account', async () => {
    const { service, repository } = createHarness();

    await expect(
      service.lookup({
        lookupType: 'email',
        value: ' Maria@Example.COM ',
      })
    ).resolves.toEqual({
      found: true,
      user: {
        email: 'maria@example.com',
        name: 'Maria Silva',
        status: 'active',
        document: '529.982.247-25',
        phone: '+5511999999999',
        access_group: 'Administradores',
        sectors: ['Comercial', 'Suporte'],
        channels: ['WhatsApp', 'Instagram'],
      },
      account: {
        id: 'account-vasco',
        name: 'Vasco',
        status: 'active',
        plan: 'Pro',
        billing_period: 'monthly',
        last_payment_at: '2026-07-13T12:00:00.000Z',
        next_renewal_at: '2999-08-13T03:00:00.000Z',
        last_paid_amount: 149.9,
      },
    });

    expect(repository.findNewestUser).toHaveBeenCalledWith({
      lookupType: 'email',
      identityHashes: ['hash:maria@example.com', 'hash:Maria@Example.COM'],
    });
    expect(repository.listAllAccountChannels).toHaveBeenCalledWith(
      'account-vasco'
    );
    expect(repository.findAccessGroup).toHaveBeenCalledWith('user-1');
    expect(repository.listSectors).toHaveBeenCalledWith('user-1');
    expect(repository.listChannels).toHaveBeenCalledWith({
      accountId: 'account-vasco',
      userId: 'user-1',
    });
    expect(repository.findCurrentOrRecentPlan).toHaveBeenCalledWith(
      'account-vasco'
    );
    expect(repository.findLatestPaidPayment).toHaveBeenCalledWith(
      'account-vasco'
    );
  });

  it('hashes compatible formatted and unformatted CPF representations', async () => {
    const { service, repository } = createHarness();

    await service.lookup({
      lookupType: 'document',
      value: '529.982.247-25',
    });

    expect(repository.findNewestUser).toHaveBeenCalledWith({
      lookupType: 'document',
      identityHashes: ['hash:52998224725', 'hash:529.982.247-25'],
    });
    expect(repository.findLatestDocument).toHaveBeenCalledWith({
      userId: 'user-1',
      preferredHashes: ['hash:52998224725', 'hash:529.982.247-25'],
    });
  });

  it('hashes compatible formatted and unformatted CNPJ representations', async () => {
    const { service, repository } = createHarness();

    await service.lookup({
      lookupType: 'document',
      value: '04.252.011/0001-10',
    });

    expect(repository.findNewestUser).toHaveBeenCalledWith({
      lookupType: 'document',
      identityHashes: ['hash:04252011000110', 'hash:04.252.011/0001-10'],
    });
  });

  it('normalizes alphanumeric CNPJ while preserving its legacy formatted hash', async () => {
    const { service, repository } = createHarness();

    await service.lookup({
      lookupType: 'document',
      value: '12.abc.345/01de-35',
    });

    expect(repository.findNewestUser).toHaveBeenCalledWith({
      lookupType: 'document',
      identityHashes: [
        'hash:12ABC34501DE35',
        'hash:12.ABC.345/01DE-35',
        'hash:12.abc.345/01de-35',
      ],
    });
  });

  it('keeps explicit channel restrictions without materializing all channels', async () => {
    const { service, repository } = createHarness();
    repository.listChannels.mockResolvedValueOnce(['WhatsApp Suporte']);

    const result = await service.lookup({
      lookupType: 'email',
      value: 'maria@example.com',
    });

    expect(result.user.channels).toEqual(['WhatsApp Suporte']);
    expect(repository.listAllAccountChannels).not.toHaveBeenCalled();
  });

  it('returns an empty channel list when the matched account has no active channels', async () => {
    const { service, repository } = createHarness();
    repository.listAllAccountChannels.mockResolvedValueOnce([]);

    const result = await service.lookup({
      lookupType: 'email',
      value: 'maria@example.com',
    });

    expect(result.user.channels).toEqual([]);
    expect(repository.listAllAccountChannels).toHaveBeenCalledWith(
      'account-vasco'
    );
  });

  it('still returns blocked users and inactive accounts with their statuses', async () => {
    const { service, repository } = createHarness();
    repository.findNewestUser.mockResolvedValueOnce({
      userId: 'user-1',
      accountId: 'account-1',
      accountName: 'Acme',
      encryptedEmail: 'email:cipher:tag',
      userStatus: 'blocked',
      accountStatus: 'inactive',
    });

    const result = await service.lookup({
      lookupType: 'email',
      value: 'maria@example.com',
    });

    expect(result).toMatchObject({
      found: true,
      user: { status: 'blocked' },
      account: { status: 'inactive' },
    });
  });

  it('returns the full null-shaped contract for invalid or unmatched identities', async () => {
    const invalidHarness = createHarness();
    const invalid = await invalidHarness.service.lookup({
      lookupType: 'document',
      value: '123',
    });
    expect(invalid.found).toBe(false);
    expect(invalid.user).toEqual({
      email: null,
      name: null,
      status: null,
      document: null,
      phone: null,
      access_group: null,
      sectors: [],
      channels: [],
    });
    expect(invalid.account).toEqual({
      id: null,
      name: null,
      status: null,
      plan: null,
      billing_period: null,
      last_payment_at: null,
      next_renewal_at: null,
      last_paid_amount: null,
    });
    expect(invalidHarness.repository.findNewestUser).not.toHaveBeenCalled();

    const unmatchedHarness = createHarness();
    unmatchedHarness.repository.findNewestUser.mockResolvedValueOnce(null);
    await expect(
      unmatchedHarness.service.lookup({
        lookupType: 'email',
        value: 'missing@example.com',
      })
    ).resolves.toEqual(invalid);
  });

  it('does not expose a past renewal and propagates malformed ciphertext as an operational error', async () => {
    const pastHarness = createHarness();
    pastHarness.repository.findCurrentOrRecentPlan.mockResolvedValueOnce({
      planName: 'Legacy',
      billingPeriod: 'annual',
      nextPaymentAt: '2020-01-01T00:00:00.000Z',
    });
    const result = await pastHarness.service.lookup({
      lookupType: 'email',
      value: 'maria@example.com',
    });
    expect(result.account.next_renewal_at).toBeNull();

    const malformedHarness = createHarness();
    malformedHarness.repository.findNewestUser.mockResolvedValueOnce({
      userId: 'user-1',
      accountId: 'account-1',
      accountName: 'Acme',
      encryptedEmail: 'not-an-aes-payload',
      userStatus: 'active',
      accountStatus: 'active',
    });
    await expect(
      malformedHarness.service.lookup({
        lookupType: 'email',
        value: 'maria@example.com',
      })
    ).rejects.toThrow('sensitive data is malformed');
  });
});
