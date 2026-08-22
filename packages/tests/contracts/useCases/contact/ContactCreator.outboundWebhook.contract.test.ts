import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({ ChatService: class {} }));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';

jest.mock('uuid', () => ({
  v7: jest.fn(() => '01900000-0000-7000-8000-000000000099'),
}));

describe('ContactCreatorUseCase outbound webhook delegation', () => {
  it('delegates exactly one contact.created intent to ContactService', async () => {
    const createContact = jest.fn(async () => 'contact-1');
    const useCase = new ContactCreatorUseCase(
      {
        existsLabelTemplatesByIds: jest.fn(async () => new Set<string>()),
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        existsContactByEmail: jest.fn(async () => false),
        existsContactByPhone: jest.fn(async () => false),
        createContact,
      } as never,
      { encrypt: jest.fn((value: string) => `hash:${value}`) } as never,
      {
        validatePhone: jest.fn(async () => ({
          valid: true,
          phone: '5511999991234',
        })),
      } as never,
      {} as never,
      {} as never,
      { validateCanCreateContact: jest.fn(async () => undefined) } as never
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        {
          name: 'Maycon',
          phone_ddi: '55',
          phone: '11999991234',
        },
        'account-1',
        [],
        'user-1',
        'public_api'
      )
    ).resolves.toBe(true);

    expect(createContact).toHaveBeenCalledTimes(1);
    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Maycon',
        phone_ddi: '55',
      }),
      'account-1',
      true,
      '01900000-0000-7000-8000-000000000099',
      {
        source: 'public_api',
        idempotencyKey: 'contact-created',
        actor: { type: 'user', id: 'user-1' },
        changes: { origin: 'public_api' },
      },
      'whatsapp_lookup'
    );
  });
});
