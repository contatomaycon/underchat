import 'reflect-metadata';
import { IntegrationService } from '@core/services/integration.service';

describe('IntegrationService official contact validation', () => {
  it('treats an official inbound number as validated without remote lookup', async () => {
    const phoneValidationService = { validatePhone: jest.fn() };
    const service = Object.create(IntegrationService.prototype) as any;
    service.phoneValidationService = phoneValidationService;
    service.contactPhoneValidationPolicyService = {
      resolve: jest.fn(async () => ({
        channelIds: ['official-1'],
        isOfficialOnly: true,
        areAllChannelsResolved: true,
      })),
    };

    await expect(
      service.validateWebhookPhoneForContactCreation(
        'account-1',
        'official-1',
        { phone: '11999999999', phone_ddi: '55' }
      )
    ).resolves.toEqual({
      phone: '11999999999',
      phone_ddi: '55',
      is_valided: true,
      validation_origin: 'official_inbound',
    });
    expect(phoneValidationService.validatePhone).not.toHaveBeenCalled();
  });

  it('promotes an assumed validation after a real non-official lookup', async () => {
    const service = Object.create(IntegrationService.prototype) as any;
    service.addLabelsToExistingContact = jest.fn(async () => undefined);
    service.contactService = {
      updateContactValidation: jest.fn(async () => true),
    };

    await expect(
      service.buildExistingContactResult(
        'account-1',
        'baileys-1',
        'contact-1',
        true,
        'official_assumed',
        '55',
        { phone: '11999999999', phone_ddi: '55' },
        {},
        {
          phone: '11999999999',
          phone_ddi: '55',
          is_valided: true,
          validation_origin: 'whatsapp_lookup',
        }
      )
    ).resolves.toEqual(
      expect.objectContaining({
        contactId: 'contact-1',
        is_valided: true,
      })
    );
    expect(service.contactService.updateContactValidation).toHaveBeenCalledWith(
      'contact-1',
      '5511999999999',
      true,
      'account-1',
      undefined,
      'whatsapp_lookup'
    );
  });

  it('does not rewrite an existing matching official inbound origin', async () => {
    const service = Object.create(IntegrationService.prototype) as any;
    service.addLabelsToExistingContact = jest.fn(async () => undefined);
    service.contactService = {
      updateContactValidation: jest.fn(async () => true),
    };

    await service.buildExistingContactResult(
      'account-1',
      'official-1',
      'contact-1',
      true,
      'official_inbound',
      '55',
      { phone: '11999999999', phone_ddi: '55' },
      {},
      {
        phone: '11999999999',
        phone_ddi: '55',
        is_valided: true,
        validation_origin: 'official_inbound',
      }
    );

    expect(
      service.contactService.updateContactValidation
    ).not.toHaveBeenCalled();
  });
});
