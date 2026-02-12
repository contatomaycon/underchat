import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { OrderPaymentCreatorUseCase } from '@core/useCases/plan/OrderPaymentCreator.useCase';
import { CreateRegisterOrderPaymentRequest } from '@core/schema/register/createOrderPayment/request.schema';
import { CreateRegisterOrderPaymentResponse } from '@core/schema/register/createOrderPayment/response.schema';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { IRegisterJwtPayload } from '@core/common/interfaces/IRegisterJwtPayload';
import { EncryptService } from '@core/services/encrypt.service';

@injectable()
export class RegisterOrderPaymentCreatorUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(OrderPaymentCreatorUseCase)
    private readonly orderPaymentCreatorUseCase: OrderPaymentCreatorUseCase,
    @inject(EncryptService)
    private readonly encryptService: EncryptService
  ) {}

  private readonly sanitizePhone = (
    phoneDdd: string | undefined,
    phone: string
  ): string => {
    const ddd = phoneDdd ?? '';

    return `${ddd}${phone}`.replaceAll(/\D/g, '');
  };

  private readonly validateRegisterContact = (
    t: TFunction<'translation', undefined>,
    registerJwtData: IRegisterJwtPayload,
    email: string,
    phoneDdd: string | undefined,
    phone: string
  ) => {
    const emailC = this.encryptService.encrypt(email);
    if (emailC !== registerJwtData.email_c) {
      throw new Error(t('register_token_invalid'));
    }

    const fullPhone = this.sanitizePhone(phoneDdd, phone);
    const phoneC = this.encryptService.encrypt(fullPhone);

    if (phoneC !== registerJwtData.phone_c) {
      throw new Error(t('register_token_invalid'));
    }
  };

  private readonly buildAccountInput = (
    input: CreateRegisterOrderPaymentRequest
  ): CreateAccountRequest => {
    const name = input.account_name.trim();

    return {
      name,
      account_status: {
        account_status_id: EAccountStatus.active,
      },
    };
  };

  private readonly buildUserInput = (
    input: CreateRegisterOrderPaymentRequest
  ): CreateUserRequest => {
    const phone = this.sanitizePhone(input.user.phone_ddd, input.user.phone);

    const birthDate =
      input.user.birth_date && input.user.birth_date.trim().length > 0
        ? input.user.birth_date
        : null;

    const address2 =
      input.user.address2 && input.user.address2.trim().length > 0
        ? input.user.address2
        : null;

    const cityFiscal =
      input.user.city_fiscal_code &&
      input.user.city_fiscal_code.trim().length > 0
        ? input.user.city_fiscal_code
        : null;

    const stateFiscal =
      input.user.state_fiscal_code &&
      input.user.state_fiscal_code.trim().length > 0
        ? input.user.state_fiscal_code
        : null;

    return {
      email: { value: input.user.email.trim() },
      password: { value: input.user.password },
      phone_ddi: { value: input.user.phone_ddi },
      phone: { value: phone },
      name: { value: input.user.name.trim() },
      last_name: { value: input.user.last_name.trim() },
      birth_date: { value: birthDate },
      document_type_id: { value: input.user.document_type_id },
      document: { value: input.user.document.trim() },
      country_id: { value: input.user.country_id },
      zip_code: { value: input.user.zip_code.trim() },
      address1: { value: input.user.address1.trim() },
      address2: { value: address2 },
      city_fiscal_code: { value: cityFiscal },
      state_fiscal_code: { value: stateFiscal },
      district: { value: input.user.district.trim() },
      permission_role_id: { value: EPermissionRole.master },
    };
  };

  private readonly buildPaymentInput = (
    input: CreateRegisterOrderPaymentRequest
  ): CreateRegisterOrderPaymentRequest => {
    const addons =
      input.addons && input.addons.length > 0 ? input.addons : undefined;

    const paymentMethod =
      input.payment_method ||
      (input.payment_method as CreateRegisterOrderPaymentRequest['payment_method']);

    const newCard =
      input.new_card && input.payment_method === 'credit_card'
        ? {
            number: input.new_card.number,
            holder_name: input.new_card.holder_name,
            expiry_month: input.new_card.expiry_month,
            expiry_year: input.new_card.expiry_year,
            cvv: input.new_card.cvv,
          }
        : undefined;

    return {
      account_name: input.account_name,
      user: input.user,
      plan_id: input.plan_id,
      billing_period: input.billing_period,
      addons,
      payment_method: paymentMethod,
      credit_card_id: input.credit_card_id,
      new_card: newCard,
      recurring_payment:
        input.payment_method === 'credit_card'
          ? input.recurring_payment
          : undefined,
      installments:
        input.payment_method === 'credit_card' &&
        input.billing_period === 'annual'
          ? input.installments
          : undefined,
    };
  };

  readonly execute = async (
    t: TFunction<'translation', undefined>,
    registerJwtData: IRegisterJwtPayload,
    input: CreateRegisterOrderPaymentRequest,
    remoteIp: string
  ): Promise<CreateRegisterOrderPaymentResponse> => {
    let createdAccountId: string | null = null;

    try {
      this.validateRegisterContact(
        t,
        registerJwtData,
        input.user.email,
        input.user.phone_ddd,
        input.user.phone
      );

      if (input.account_name.length > 10) {
        throw new Error(t('account_name_cannot_exceed_10_characters'));
      }

      const accountInput = this.buildAccountInput(input);
      const accountId =
        await this.accountService.createAccountWithPlanAndApiKey(accountInput);

      if (!accountId) {
        throw new Error(t('account_creation_failed'));
      }

      createdAccountId = accountId;

      const userInput = this.buildUserInput(input);
      const userCreated = await this.userService.createUser(
        t,
        accountId,
        userInput
      );

      if (!userCreated) {
        throw new Error(t('user_creation_failed'));
      }

      const paymentInput = this.buildPaymentInput(input);

      const result = await this.orderPaymentCreatorUseCase.execute(
        t,
        accountId,
        {
          plan_id: paymentInput.plan_id,
          billing_period: paymentInput.billing_period,
          addons: paymentInput.addons,
          payment_method: paymentInput.payment_method,
          credit_card_id: paymentInput.credit_card_id,
          new_card: paymentInput.new_card
            ? {
                number: paymentInput.new_card.number,
                holder_name: paymentInput.new_card.holder_name,
                expiry_month: paymentInput.new_card.expiry_month,
                expiry_year: paymentInput.new_card.expiry_year,
                cvv: paymentInput.new_card.cvv,
              }
            : undefined,
          recurring_payment: paymentInput.recurring_payment,
          installments: paymentInput.installments,
        },
        remoteIp
      );

      return {
        ...result,
        account_id: accountId,
      };
    } catch (error) {
      if (createdAccountId) {
        await this.accountService.deleteAccountById(createdAccountId);
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(t('order_payment_creation_failed'));
    }
  };
}
