import 'reflect-metadata';

jest.mock('@core/services/payment.service', () => ({
  PaymentService: class {},
}));
jest.mock('@core/repositories/plan/UserCardsLister.repository', () => ({
  UserCardsListerRepository: class {},
}));

import { UserCardCreatorUseCase } from '@core/useCases/accountSettings/UserCardCreator.useCase';

describe('UserCardCreatorUseCase', () => {
  const input = {
    number: '4111111111111111',
    holder_name: 'Maycon',
    expiry_month: '1',
    expiry_year: '2030',
    cvv: '123',
  };

  it('throws when payment service does not return card id', async () => {
    const paymentService = {
      getOrCreateCustomer: jest.fn(async () => ({ user_customer: 'cus-1' })),
      tokenizeAndSaveNewCard: jest.fn(async () => ({})),
    };
    const userCardsRepository = {
      listUserCards: jest.fn(),
    };
    const useCase = new UserCardCreatorUseCase(
      paymentService as never,
      userCardsRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', '127.0.0.1', input)
    ).rejects.toThrow('card_creation_failed');
    expect(userCardsRepository.listUserCards).not.toHaveBeenCalled();
  });

  it('throws when created card is not found in user card list', async () => {
    const paymentService = {
      getOrCreateCustomer: jest.fn(async () => ({ user_customer: 'cus-1' })),
      tokenizeAndSaveNewCard: jest.fn(async () => ({ userCardId: 'card-1' })),
    };
    const userCardsRepository = {
      listUserCards: jest.fn(async () => []),
    };
    const useCase = new UserCardCreatorUseCase(
      paymentService as never,
      userCardsRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', '127.0.0.1', input)
    ).rejects.toThrow('card_not_found');
  });

  it('returns created card data', async () => {
    const paymentService = {
      getOrCreateCustomer: jest.fn(async () => ({ user_customer: 'cus-1' })),
      tokenizeAndSaveNewCard: jest.fn(async () => ({ userCardId: 'card-1' })),
    };
    const userCardsRepository = {
      listUserCards: jest.fn(async () => [
        {
          user_card_id: 'card-1',
          holder_name: 'Maycon',
          last_number: '1111',
          brand: 'visa',
          default: true,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
    };
    const useCase = new UserCardCreatorUseCase(
      paymentService as never,
      userCardsRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', '127.0.0.1', input)
    ).resolves.toEqual({
      user_card_id: 'card-1',
      holder_name: 'Maycon',
      last_number: '1111',
      brand: 'visa',
      default: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });

    expect(paymentService.tokenizeAndSaveNewCard).toHaveBeenCalledWith(
      'user-1',
      'cus-1',
      '127.0.0.1',
      {
        number: input.number,
        holder_name: input.holder_name,
        expiry_month: input.expiry_month,
        expiry_year: input.expiry_year,
        cvv: input.cvv,
      }
    );
  });

  it('uses current date when created card does not have created_at', async () => {
    const paymentService = {
      getOrCreateCustomer: jest.fn(async () => ({ user_customer: 'cus-1' })),
      tokenizeAndSaveNewCard: jest.fn(async () => ({ userCardId: 'card-1' })),
    };
    const userCardsRepository = {
      listUserCards: jest.fn(async () => [
        {
          user_card_id: 'card-1',
          holder_name: 'Maycon',
          last_number: '1111',
          brand: 'visa',
          default: false,
          created_at: null,
        },
      ]),
    };
    const useCase = new UserCardCreatorUseCase(
      paymentService as never,
      userCardsRepository as never
    );

    const result = await useCase.execute(
      jest.fn() as never,
      'user-1',
      'acc-1',
      '127.0.0.1',
      input
    );

    expect(result.user_card_id).toBe('card-1');
    expect(result.created_at).toEqual(expect.any(String));
  });
});
