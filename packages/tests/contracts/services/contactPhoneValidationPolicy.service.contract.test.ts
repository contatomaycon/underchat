import 'reflect-metadata';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ContactPhoneValidationPolicyService } from '@core/services/contactPhoneValidationPolicy.service';

describe('ContactPhoneValidationPolicyService', () => {
  const makeService = (input?: {
    contactChannelIds?: string[];
    channels?: Array<{ worker_id: string; worker_type_id: string }>;
  }) => {
    const repository = {
      listContactChannelIds: jest.fn(
        async () => input?.contactChannelIds ?? []
      ),
      listAccountChannels: jest.fn(async () => input?.channels ?? []),
      viewValidationState: jest.fn(async () => null),
    };

    return {
      service: new ContactPhoneValidationPolicyService(repository as never),
      repository,
    };
  };

  it('accepts a fully resolved explicit official scope', async () => {
    const { service, repository } = makeService({
      channels: [
        { worker_id: 'official-1', worker_type_id: EWorkerType.whatsapp },
      ],
    });

    await expect(
      service.resolve({
        accountId: 'account-1',
        requestedChannelIds: ['official-1', 'official-1'],
      })
    ).resolves.toEqual({
      channelIds: ['official-1'],
      isOfficialOnly: true,
      areAllChannelsResolved: true,
    });
    expect(repository.listAccountChannels).toHaveBeenCalledWith('account-1', [
      'official-1',
    ]);
  });

  it('rejects mixed, non-official and partially resolved explicit scopes', async () => {
    const cases = [
      {
        requested: ['official-1', 'baileys-1'],
        channels: [
          { worker_id: 'official-1', worker_type_id: EWorkerType.whatsapp },
          { worker_id: 'baileys-1', worker_type_id: EWorkerType.baileys },
        ],
        allResolved: true,
      },
      {
        requested: ['wwebjs-1'],
        channels: [
          { worker_id: 'wwebjs-1', worker_type_id: EWorkerType.wwebjs },
        ],
        allResolved: true,
      },
      {
        requested: ['official-1', 'other-account-1'],
        channels: [
          { worker_id: 'official-1', worker_type_id: EWorkerType.whatsapp },
        ],
        allResolved: false,
      },
    ];

    for (const testCase of cases) {
      const { service } = makeService({ channels: testCase.channels });
      const result = await service.resolve({
        accountId: 'account-1',
        requestedChannelIds: testCase.requested,
      });

      expect(result.isOfficialOnly).toBe(false);
      expect(result.areAllChannelsResolved).toBe(testCase.allResolved);
    }
  });

  it('uses contact associations and falls back to all account channels only when none exist', async () => {
    const associated = makeService({
      contactChannelIds: ['official-1'],
      channels: [
        { worker_id: 'official-1', worker_type_id: EWorkerType.whatsapp },
      ],
    });
    await expect(
      associated.service.resolve({
        accountId: 'account-1',
        contactId: 'contact-1',
      })
    ).resolves.toEqual({
      channelIds: ['official-1'],
      isOfficialOnly: true,
      areAllChannelsResolved: true,
    });
    expect(associated.repository.listAccountChannels).toHaveBeenCalledWith(
      'account-1',
      ['official-1']
    );

    const accountWide = makeService({
      channels: [
        { worker_id: 'official-1', worker_type_id: EWorkerType.whatsapp },
        { worker_id: 'baileys-1', worker_type_id: EWorkerType.baileys },
      ],
    });
    const result = await accountWide.service.resolve({
      accountId: 'account-1',
      contactId: 'contact-1',
    });
    expect(result.isOfficialOnly).toBe(false);
    expect(accountWide.repository.listAccountChannels).toHaveBeenCalledWith(
      'account-1',
      undefined
    );
  });

  it('does not assume validity when the account has no channels', async () => {
    const { service } = makeService();

    await expect(
      service.resolve({ accountId: 'account-1', requestedChannelIds: [] })
    ).resolves.toEqual({
      channelIds: [],
      isOfficialOnly: false,
      areAllChannelsResolved: true,
    });
  });
});
