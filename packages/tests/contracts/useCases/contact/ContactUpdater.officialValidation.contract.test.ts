import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({ ChatService: class {} }));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';

describe('ContactUpdaterUseCase official validation', () => {
  it('reconciles an invalid contact when its resulting scope is official-only', async () => {
    const previousContact = {
      contact_id: 'contact-1',
      name: 'Contact',
      phone_ddi: '55',
      is_valided: false,
    };
    const updateContactById = jest.fn(async () => true);
    const contactService = {
      getContactById: jest
        .fn()
        .mockResolvedValueOnce(previousContact)
        .mockResolvedValueOnce(null),
      updateContactById,
    };
    const phoneValidationService = { validatePhone: jest.fn() };
    const useCase = new ContactUpdaterUseCase(
      contactService as never,
      { existsLabelTemplatesByIds: jest.fn() } as never,
      {} as never,
      phoneValidationService as never,
      { findChatsByContactId: jest.fn(async () => []) } as never,
      {} as never,
      {
        viewContactMutationRevision: jest.fn(async () => ({
          revision: '1',
          photo: null,
        })),
      } as never,
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
        'account-1',
        'contact-1',
        { channel_ids: ['official-1'] }
      )
    ).resolves.toBe(true);

    expect(phoneValidationService.validatePhone).not.toHaveBeenCalled();
    expect(updateContactById).toHaveBeenCalledWith(
      expect.objectContaining({ channel_ids: ['official-1'] }),
      'contact-1',
      'account-1',
      expect.any(Object),
      { isValidated: true, origin: 'official_assumed' }
    );
  });
});
