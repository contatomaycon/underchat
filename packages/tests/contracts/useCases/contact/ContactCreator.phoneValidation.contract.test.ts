import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({ ChatService: class {} }));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { ContactCreationClientError } from '@core/common/exceptions/ContactCreationClientError';
import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';

describe('ContactCreatorUseCase phone validation', () => {
  it.each([
    {
      title: 'a negative validation response',
      validatePhone: jest.fn(async () => ({ valid: false, phone: null })),
    },
    {
      title: 'an explicit validation rejection',
      validatePhone: jest.fn(async () => {
        throw new Error('phone_number_not_valid_on_whatsapp');
      }),
    },
  ])(
    'raises a typed client error and does not persist for $title',
    async ({ validatePhone }) => {
      const createContact = jest.fn();
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
        { validatePhone } as never,
        {} as never,
        {} as never,
        { validateCanCreateContact: jest.fn(async () => undefined) } as never
      );

      await expect(
        useCase.execute(
          ((key: string) => `translated:${key}`) as never,
          {
            name: 'Invalid phone',
            phone_ddi: '55',
            phone: '11999999999',
          },
          'account-1',
          [],
          'user-1',
          'public_api'
        )
      ).rejects.toEqual(
        expect.objectContaining({
          name: ContactCreationClientError.name,
          message: 'translated:phone_number_not_valid_on_whatsapp',
          httpStatusCode: EHTTPStatusCode.bad_request,
        })
      );

      expect(createContact).not.toHaveBeenCalled();
    }
  );

  it('persists an official-only contact as assumed without remote validation', async () => {
    const validatePhone = jest.fn();
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
      { validatePhone } as never,
      {} as never,
      {} as never,
      { validateCanCreateContact: jest.fn(async () => undefined) } as never,
      {
        resolve: jest.fn(async () => ({
          channelIds: ['official-1'],
          isOfficialOnly: true,
          areAllChannelsResolved: true,
        })),
      } as never
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        {
          name: 'Official contact',
          phone_ddi: '55',
          phone: '11999999999',
          channel_ids: ['official-1'],
        },
        'account-1'
      )
    ).resolves.toBe(true);

    expect(validatePhone).not.toHaveBeenCalled();
    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({ channel_ids: ['official-1'] }),
      'account-1',
      true,
      expect.any(String),
      expect.any(Object),
      'official_assumed'
    );
  });
});
