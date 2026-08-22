import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({ ChatService: class {} }));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { ContactCreationClientError } from '@core/common/exceptions/ContactCreationClientError';
import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';

interface UseCaseOverrides {
  readonly accountExists?: boolean;
  readonly existingLabelTemplateIds?: ReadonlySet<string>;
  readonly emailExists?: boolean;
  readonly phoneExists?: boolean;
  readonly planError?: Error;
}

function makeUseCase(overrides: UseCaseOverrides = {}): ContactCreatorUseCase {
  return new ContactCreatorUseCase(
    {
      existsLabelTemplatesByIds: jest.fn(
        async () => new Set(overrides.existingLabelTemplateIds ?? [])
      ),
    } as never,
    {
      existsAccountById: jest.fn(async () => overrides.accountExists ?? true),
    } as never,
    {
      existsContactByEmail: jest.fn(async () => overrides.emailExists ?? false),
      existsContactByPhone: jest.fn(async () => overrides.phoneExists ?? false),
      createContact: jest.fn(async () => 'contact-1'),
    } as never,
    { encrypt: jest.fn((value: string) => `hash:${value}`) } as never,
    {
      validatePhone: jest.fn(async () => ({
        valid: true,
        phone: '5511999999999',
      })),
    } as never,
    {} as never,
    {} as never,
    {
      validateCanCreateContact: jest.fn(async () => {
        if (overrides.planError) {
          throw overrides.planError;
        }
      }),
    } as never
  );
}

interface ClientFailureCase {
  readonly title: string;
  readonly input: Record<string, unknown>;
  readonly allowedChannelIds?: string[];
  readonly overrides?: UseCaseOverrides;
  readonly expectedMessage: string;
  readonly expectedStatus: EHTTPStatusCode;
}

const validInput = {
  name: 'Contact',
  phone_ddi: '55',
  phone: '11999999999',
};

const clientFailureCases: ClientFailureCase[] = [
  {
    title: 'empty name',
    input: { ...validInput, name: '' },
    expectedMessage: 'name_required',
    expectedStatus: EHTTPStatusCode.bad_request,
  },
  {
    title: 'empty phone DDI',
    input: { ...validInput, phone_ddi: '' },
    expectedMessage: 'phone_ddi_required',
    expectedStatus: EHTTPStatusCode.bad_request,
  },
  {
    title: 'empty phone',
    input: { ...validInput, phone: '' },
    expectedMessage: 'phone_required',
    expectedStatus: EHTTPStatusCode.bad_request,
  },
  {
    title: 'invalid birthday',
    input: { ...validInput, birthday: '31/12/2000' },
    expectedMessage: 'date_must_be_in_the_format_yyyy_mm_dd',
    expectedStatus: EHTTPStatusCode.bad_request,
  },
  {
    title: 'channel outside the caller scope',
    input: { ...validInput, channel_ids: ['channel-denied'] },
    allowedChannelIds: ['channel-allowed'],
    expectedMessage: 'contact_channel_not_allowed',
    expectedStatus: EHTTPStatusCode.forbidden,
  },
  {
    title: 'missing account',
    input: validInput,
    overrides: { accountExists: false },
    expectedMessage: 'account_not_found',
    expectedStatus: EHTTPStatusCode.not_found,
  },
  {
    title: 'missing label template',
    input: {
      ...validInput,
      label_template_ids: [{ value: 'label-missing' }],
    },
    expectedMessage: 'label_template_not_found',
    expectedStatus: EHTTPStatusCode.not_found,
  },
  {
    title: 'duplicate email',
    input: { ...validInput, email: 'contact@example.com' },
    overrides: { emailExists: true },
    expectedMessage: 'contact_already_exists_email',
    expectedStatus: EHTTPStatusCode.conflict,
  },
  {
    title: 'duplicate phone',
    input: validInput,
    overrides: { phoneExists: true },
    expectedMessage: 'contact_already_exists_phone',
    expectedStatus: EHTTPStatusCode.conflict,
  },
  {
    title: 'plan without contact capacity',
    input: validInput,
    overrides: { planError: new Error('translated:contact_not_available') },
    expectedMessage: 'contact_not_available',
    expectedStatus: EHTTPStatusCode.bad_request,
  },
];

describe('ContactCreatorUseCase expected client failures', () => {
  it.each(clientFailureCases)(
    'types $title with its HTTP contract',
    async (testCase) => {
      const useCase = makeUseCase(testCase.overrides);

      await expect(
        useCase.execute(
          ((key: string) => `translated:${key}`) as never,
          testCase.input as never,
          'account-1',
          testCase.allowedChannelIds ?? [],
          'user-1',
          'public_api'
        )
      ).rejects.toEqual(
        expect.objectContaining({
          name: ContactCreationClientError.name,
          message: `translated:${testCase.expectedMessage}`,
          httpStatusCode: testCase.expectedStatus,
        })
      );
    }
  );

  it('does not type an unexpected plan service failure as a client error', async () => {
    const useCase = makeUseCase({
      planError: new Error('plan_database_connection_failed'),
    });

    try {
      await useCase.execute(
        ((key: string) => `translated:${key}`) as never,
        validInput,
        'account-1',
        [],
        'user-1',
        'public_api'
      );
      throw new Error('Expected contact creation to fail');
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining({ message: 'plan_database_connection_failed' })
      );
      expect(error).not.toBeInstanceOf(ContactCreationClientError);
    }
  });
});
