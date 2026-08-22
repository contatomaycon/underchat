import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/useCases/plan/OrderPaymentCreator.useCase', () => ({
  OrderPaymentCreatorUseCase: class {},
}));
jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class {},
}));

import { RegisterOrderPaymentCreatorUseCase } from '@core/useCases/register/RegisterOrderPaymentCreator.useCase';
import { CreditCardSourceSelectionError } from '@core/common/exceptions/UserCardError';

describe('RegisterOrderPaymentCreatorUseCase', () => {
  const buildInput = () => ({
    account_name: 'Acme',
    user: {
      email: 'USER@EXAMPLE.COM',
      password: 'Abcd1234',
      phone_ddi: '+55',
      phone_ddd: '11',
      phone: '99999-0000',
      name: ' Maycon ',
      last_name: ' Silva ',
      birth_date: ' ',
      document_type_id: 'cpf',
      document: ' 12345678900 ',
      country_id: 55,
      zip_code: ' 01001-000 ',
      address1: ' Rua A ',
      address2: ' ',
      city_fiscal_code: ' ',
      state_fiscal_code: ' ',
      district: ' Centro ',
    },
    plan_id: 'plan-1',
    billing_period: 'annual',
    addons: [],
    payment_method: 'credit_card',
    credit_card_id: undefined,
    new_card: {
      number: '4111111111111111',
      holder_name: 'Maycon',
      expiry_month: '01',
      expiry_year: '2030',
      cvv: '123',
    },
    recurring_payment: true,
    installments: 12,
  });

  const buildDeps = (overrides: Record<string, unknown> = {}) => {
    const accountService = {
      createAccountWithPlanAndApiKey: jest.fn(async () => 'acc-1'),
      deleteAccountById: jest.fn(async () => true),
      ...((overrides.accountService as object) ?? {}),
    };
    const userService = {
      existsUserEmailById: jest.fn(async () => false),
      createUser: jest.fn(async () => true),
      ...((overrides.userService as object) ?? {}),
    };
    const orderPaymentCreatorUseCase = {
      execute: jest.fn(async () => ({ order_payment_id: 'ord-1' })),
      ...((overrides.orderPaymentCreatorUseCase as object) ?? {}),
    };
    const encryptService = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      ...((overrides.encryptService as object) ?? {}),
    };

    const useCase = new RegisterOrderPaymentCreatorUseCase(
      accountService as never,
      userService as never,
      orderPaymentCreatorUseCase as never,
      encryptService as never
    );

    return {
      useCase,
      accountService,
      userService,
      orderPaymentCreatorUseCase,
      encryptService,
    };
  };

  it('sanitizes phone by joining ddd and digits only', () => {
    const { useCase } = buildDeps();

    expect((useCase as any).sanitizePhone('11', '99999-0000')).toBe(
      '11999990000'
    );
    expect((useCase as any).sanitizePhone(undefined, '(21) 98888-7777')).toBe(
      '21988887777'
    );
  });

  it('throws when register token email does not match', () => {
    const { useCase } = buildDeps();
    const t = jest.fn((key: string) => key);

    expect(() =>
      (useCase as any).validateRegisterContact(
        t,
        { email_c: 'enc:other@email.com', phone_c: 'enc:11999990000' },
        'user@example.com',
        '11',
        '99999-0000'
      )
    ).toThrow('register_token_invalid');
  });

  it('throws when register token phone does not match', () => {
    const { useCase } = buildDeps();
    const t = jest.fn((key: string) => key);

    expect(() =>
      (useCase as any).validateRegisterContact(
        t,
        { email_c: 'enc:user@example.com', phone_c: 'enc:wrong' },
        'user@example.com',
        '11',
        '99999-0000'
      )
    ).toThrow('register_token_invalid');
  });

  it('builds payment input with credit card rules', () => {
    const { useCase } = buildDeps();
    const input = buildInput();

    const paymentInput = (useCase as any).buildPaymentInput(input);
    expect(paymentInput.new_card).toEqual(input.new_card);
    expect(paymentInput.installments).toBe(12);
    expect(paymentInput.recurring_payment).toBe(true);

    const pixInput = {
      ...input,
      payment_method: 'pix',
      new_card: input.new_card,
      recurring_payment: true,
      installments: 12,
    };
    const paymentPix = (useCase as any).buildPaymentInput(pixInput);
    expect(paymentPix.new_card).toBeUndefined();
    expect(paymentPix.recurring_payment).toBeUndefined();
    expect(paymentPix.installments).toBeUndefined();
  });

  it('builds user input keeping optional values when provided', () => {
    const { useCase } = buildDeps();
    const input = buildInput();
    input.user.birth_date = '1990-01-01';
    input.user.address2 = 'Apt 101';
    input.user.city_fiscal_code = '3550308';
    input.user.state_fiscal_code = '35';

    const userInput = (useCase as any).buildUserInput(input);
    expect(userInput.birth_date.value).toBe('1990-01-01');
    expect(userInput.address2.value).toBe('Apt 101');
    expect(userInput.city_fiscal_code.value).toBe('3550308');
    expect(userInput.state_fiscal_code.value).toBe('35');
  });

  it('keeps addons when they are provided in payment input', () => {
    const { useCase } = buildDeps();
    const input = buildInput();
    input.addons = [{ addon_id: 'a-1' }] as any;

    const paymentInput = (useCase as any).buildPaymentInput(input);
    expect(paymentInput.addons).toEqual([{ addon_id: 'a-1' }]);
  });

  it('throws when account name exceeds max length', async () => {
    const { useCase } = buildDeps();
    const t = jest.fn((key: string) => key);
    const input = buildInput();
    input.account_name = '12345678901';

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).rejects.toThrow('account_name_cannot_exceed_10_characters');
  });

  it.each([
    [
      'both a saved card and new card',
      {
        credit_card_id: 'card-1',
      },
    ],
    [
      'neither a saved card nor a new card',
      {
        credit_card_id: undefined,
        new_card: undefined,
      },
    ],
  ])(
    'rejects registration with %s before creating an account',
    async (_description, cardSource) => {
      const {
        useCase,
        accountService,
        userService,
        orderPaymentCreatorUseCase,
      } = buildDeps();
      const input = {
        ...buildInput(),
        ...cardSource,
      };

      await expect(
        useCase.execute(
          jest.fn() as never,
          {
            email_c: 'enc:user@example.com',
            phone_c: 'enc:11999990000',
          } as never,
          input as never,
          '127.0.0.1'
        )
      ).rejects.toBeInstanceOf(CreditCardSourceSelectionError);

      expect(
        accountService.createAccountWithPlanAndApiKey
      ).not.toHaveBeenCalled();
      expect(userService.createUser).not.toHaveBeenCalled();
      expect(orderPaymentCreatorUseCase.execute).not.toHaveBeenCalled();
    }
  );

  it('throws when user email already exists', async () => {
    const { useCase, userService } = buildDeps({
      userService: {
        existsUserEmailById: jest.fn(async () => true),
      },
    });
    const t = jest.fn((key: string) => key);
    const input = buildInput();

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).rejects.toThrow('email_already_registered');
    expect(userService.createUser).not.toHaveBeenCalled();
  });

  it('throws when account creation fails', async () => {
    const { useCase, accountService } = buildDeps({
      accountService: {
        createAccountWithPlanAndApiKey: jest.fn(async () => null),
      },
    });
    const t = jest.fn((key: string) => key);
    const input = buildInput();

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).rejects.toThrow('account_creation_failed');
    expect(accountService.deleteAccountById).not.toHaveBeenCalled();
  });

  it('deletes account when user creation fails', async () => {
    const { useCase, accountService } = buildDeps({
      userService: {
        createUser: jest.fn(async () => false),
      },
    });
    const t = jest.fn((key: string) => key);
    const input = buildInput();

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).rejects.toThrow('user_creation_failed');
    expect(accountService.deleteAccountById).toHaveBeenCalledWith('acc-1');
  });

  it('converts unknown errors from order payment to order_payment_creation_failed and rollbacks account', async () => {
    const { useCase, accountService } = buildDeps({
      orderPaymentCreatorUseCase: {
        execute: jest.fn(async () => {
          throw 'unknown';
        }),
      },
    });
    const t = jest.fn((key: string) => key);
    const input = buildInput();

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).rejects.toThrow('order_payment_creation_failed');
    expect(accountService.deleteAccountById).toHaveBeenCalledWith('acc-1');
  });

  it('returns order payment response with account_id on success', async () => {
    const { useCase, orderPaymentCreatorUseCase } = buildDeps();
    const t = jest.fn((key: string) => key);
    const input = buildInput();

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).resolves.toEqual({
      order_payment_id: 'ord-1',
      account_id: 'acc-1',
    });

    expect(orderPaymentCreatorUseCase.execute).toHaveBeenCalledWith(
      t,
      'acc-1',
      expect.objectContaining({
        plan_id: 'plan-1',
        billing_period: 'annual',
        payment_method: 'credit_card',
        recurring_payment: true,
        installments: 12,
      }),
      '127.0.0.1',
      {
        email: 'user@example.com',
        document: '12345678900',
        phone: '11999990000',
      }
    );
  });

  it('sends undefined new_card when payment method is not credit_card', async () => {
    const { useCase, orderPaymentCreatorUseCase } = buildDeps();
    const t = jest.fn((key: string) => key);
    const input = buildInput();
    input.payment_method = 'pix';

    await expect(
      useCase.execute(
        t as never,
        {
          email_c: 'enc:user@example.com',
          phone_c: 'enc:11999990000',
        } as never,
        input as never,
        '127.0.0.1'
      )
    ).resolves.toEqual({
      order_payment_id: 'ord-1',
      account_id: 'acc-1',
    });

    expect(orderPaymentCreatorUseCase.execute).toHaveBeenCalledWith(
      t,
      'acc-1',
      expect.objectContaining({
        payment_method: 'pix',
        new_card: undefined,
      }),
      '127.0.0.1',
      expect.any(Object)
    );
  });
});
