import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { PaymentService } from '@core/services/payment.service';
import { PlanService } from '@core/services/plan.service';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import { EPaymentBillingType } from '@core/common/enums/EPaymentBillingType';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { PlanReleaseService } from '@core/services/planRelease.service';
import { AccountTestService } from '@core/services/accountTest.service';
import { CreditCardFeeService } from '@core/services/creditCardFee.service';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { UserService } from '@core/services/user.service';
import { MethodPaymentService } from '@core/services/methodPayment.service';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';
import { randomUUID } from 'node:crypto';

@injectable()
export class OrderPaymentCreatorUseCase {
  constructor(
    @inject(PaymentService)
    private readonly paymentService: PaymentService,
    @inject(PlanService)
    private readonly planService: PlanService,
    @inject(PlanReleaseService)
    private readonly planReleaseService: PlanReleaseService,
    @inject(AccountTestService)
    private readonly accountTestService: AccountTestService,
    @inject(UserMasterViewerRepository)
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(CreditCardFeeService)
    private readonly creditCardFeeService: CreditCardFeeService,
    @inject(MethodPaymentService)
    private readonly methodPaymentService: MethodPaymentService
  ) {}

  private readonly applyCreditCardFee = (
    totalAmount: number,
    feeRate: number
  ): number => {
    if (!feeRate) {
      return totalAmount;
    }
    const multiplier = 1 + feeRate / 100;
    return Math.round(totalAmount * multiplier * 100) / 100;
  };

  private readonly monthlyCreditCardFeeInstallment = 3;

  private readonly getCreditCardFeeRate = async (
    t: TFunction<'translation', undefined>,
    installments: number
  ): Promise<number> => {
    const creditCardFee = await this.creditCardFeeService.viewCreditCardFee();
    if (!creditCardFee) {
      throw new Error(t('credit_card_fee_not_found'));
    }
    const rates: Record<number, number> = {
      1: creditCardFee.installment_1_rate,
      2: creditCardFee.installment_2_rate,
      3: creditCardFee.installment_3_rate,
      4: creditCardFee.installment_4_rate,
      5: creditCardFee.installment_5_rate,
      6: creditCardFee.installment_6_rate,
      7: creditCardFee.installment_7_rate,
      8: creditCardFee.installment_8_rate,
      9: creditCardFee.installment_9_rate,
      10: creditCardFee.installment_10_rate,
      11: creditCardFee.installment_11_rate,
      12: creditCardFee.installment_12_rate,
    };
    return rates[installments] ?? 0;
  };

  private readonly getCreditCardFeeInstallment = (
    input: CreateOrderPaymentRequest
  ): number | null => {
    if (input.payment_method !== 'credit_card') {
      return null;
    }

    if (input.billing_period === 'monthly') {
      return this.monthlyCreditCardFeeInstallment;
    }

    return input.installments ?? null;
  };

  private readonly isAsaasPaymentSuccessful = (status: string): boolean => {
    return (
      status === 'RECEIVED' ||
      status === 'CONFIRMED' ||
      status === 'RECEIVED_IN_CASH'
    );
  };

  private readonly mapAsaasStatusToPaymentStatus = (status: string): string => {
    if (status === 'RECEIVED') {
      return EPaymentStatus.received;
    }

    if (status === 'CONFIRMED') {
      return EPaymentStatus.confirmed;
    }

    if (status === 'RECEIVED_IN_CASH') {
      return EPaymentStatus.received_in_cash;
    }

    return EPaymentStatus.pending;
  };

  private async processTestPlan(
    t: TFunction<'translation', undefined>,
    accountId: string,
    planId: string,
    plan: { is_test: boolean; days_trial: number | null },
    input: CreateOrderPaymentRequest
  ): Promise<CreateOrderPaymentResponse> {
    if (input.addons && input.addons.length > 0) {
      throw new Error(t('test_plan_cannot_have_addons'));
    }

    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      throw new Error(t('master_user_not_found'));
    }

    const sensitiveData = await this.userService.getUserSensitiveDataDecrypted(
      masterUser.user_id
    );

    if (!sensitiveData) {
      throw new Error(t('user_sensitive_data_not_found'));
    }

    if (
      !sensitiveData.document ||
      !sensitiveData.phone ||
      !sensitiveData.email
    ) {
      throw new Error(t('test_plan_required_fields'));
    }

    const hasExistingTest = await this.accountTestService.checkExistingTest({
      document: sensitiveData.document,
      phone: sensitiveData.phone,
      email: sensitiveData.email,
    });

    if (hasExistingTest) {
      throw new Error(t('test_plan_already_used'));
    }

    if (!plan.days_trial || plan.days_trial <= 0) {
      throw new Error(t('test_plan_required_fields'));
    }

    await this.accountTestService.createTestPlan({
      accountId,
      planId,
      daysTrial: plan.days_trial,
      document: sensitiveData.document,
      phone: sensitiveData.phone,
      email: sensitiveData.email,
    });

    return {
      order_id: randomUUID(),
      total_amount: 0,
      plan_price: 0,
      addons_total: 0,
      upgrade_discount: 0,
      payment_method: input.payment_method,
      pix_payment: undefined,
      credit_card_payment: undefined,
      boleto_payment: undefined,
    };
  }

  private async processRegularPayment(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateOrderPaymentRequest,
    remoteIp: string
  ): Promise<CreateOrderPaymentResponse> {
    const customer = await this.paymentService.getOrCreateCustomer(
      t,
      accountId
    );

    const orderCalculation = await this.planService.calculateOrderPayment(
      accountId,
      input
    );

    const planPrice = orderCalculation.planPrice;
    const addonsTotal = orderCalculation.addonsTotal;
    const discountAmount = orderCalculation.discountAmount;
    let totalAmount = orderCalculation.totalAmount;

    const creditCardFeeInstallment = this.getCreditCardFeeInstallment(input);

    if (creditCardFeeInstallment) {
      const feeRate = await this.getCreditCardFeeRate(
        t,
        creditCardFeeInstallment
      );
      totalAmount = this.applyCreditCardFee(totalAmount, feeRate);
    }

    const orderId = randomUUID();

    const pixPaymentData =
      input.payment_method === 'pix'
        ? await this.processPixPayment({
            t,
            accountId,
            customer,
            planId: input.plan_id,
            totalAmount,
            orderId,
            billingPeriod: input.billing_period,
            addons: input.addons || [],
          })
        : undefined;

    const creditCardPaymentData =
      input.payment_method === 'credit_card'
        ? await this.processCreditCardPayment({
            t,
            accountId,
            customer,
            planId: input.plan_id,
            totalAmount,
            orderId,
            billingPeriod: input.billing_period,
            addons: input.addons || [],
            remoteIp,
            input,
          })
        : undefined;

    const boletoPaymentData =
      input.payment_method === 'boleto'
        ? await this.processBoletoPayment({
            t,
            accountId,
            customer,
            planId: input.plan_id,
            totalAmount,
            orderId,
            billingPeriod: input.billing_period,
            addons: input.addons || [],
          })
        : undefined;

    return {
      order_id: orderId,
      total_amount: totalAmount,
      plan_price: planPrice,
      addons_total: addonsTotal,
      upgrade_discount: discountAmount,
      payment_method: input.payment_method,
      pix_payment: pixPaymentData,
      credit_card_payment: creditCardPaymentData,
      boleto_payment: boletoPaymentData,
    };
  }

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateOrderPaymentRequest,
    remoteIp: string
  ): Promise<CreateOrderPaymentResponse> => {
    try {
      const plan = await this.planService.getPlan(input.plan_id);
      if (!plan) {
        throw new Error(t('plan_not_found'));
      }

      const isTestPlan = plan.is_test === true && (plan.days_trial ?? 0) > 0;
      if (!isTestPlan) {
        await this.validatePaymentMethod(t, input.payment_method);
      }

      if (isTestPlan) {
        return this.processTestPlan(t, accountId, input.plan_id, plan, input);
      }

      return this.processRegularPayment(t, accountId, input, remoteIp);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(t('order_payment_creation_failed'));
    }
  };

  private readonly validatePaymentMethod = async (
    t: TFunction<'translation', undefined>,
    paymentMethod: string
  ): Promise<void> => {
    const methodPayment =
      await this.methodPaymentService.viewMethodPaymentByType(
        paymentMethod as EMethodPayment
      );

    if (!methodPayment || !methodPayment.status) {
      throw new Error(t('payment_method_disabled'));
    }
  };

  private readonly processPixPayment = async (data: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    customer: { user_customer_id: string; user_customer: string };
    planId: string;
    totalAmount: number;
    orderId: string;
    billingPeriod: 'monthly' | 'annual';
    addons: Array<{ plan_cross_sell_id: string }>;
  }) => {
    const billingPeriodId = this.planService.getBillingPeriodId(
      data.billingPeriod
    );
    if (!billingPeriodId) {
      throw new Error(data.t('billing_period_not_found'));
    }

    const pixResult = await this.paymentService.createPixPayment(
      data.customer.user_customer,
      data.totalAmount,
      `Pagamento do plano ${data.planId}`,
      data.orderId,
      data.accountId
    );

    if (!pixResult.payment || !pixResult.qrCode) {
      throw new Error(data.t('pix_payment_creation_failed'));
    }

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId: data.accountId,
      userCustomerId: data.customer.user_customer_id,
      planId: data.planId,
      billing: pixResult.payment.id,
      paymentBillingTypeId: EPaymentBillingType.pix,
      value: data.totalAmount.toString(),
      netValue: pixResult.payment.netValue.toString(),
      pixTransaction: pixResult.payment.pixTransaction || null,
      paymentStatusId: EPaymentStatus.pending,
      billingPeriodId,
      invoiceUrl: pixResult.payment.invoiceUrl || null,
      recurringPayment: false,
    });

    await this.planService.createAccountPaymentCrossSells({
      accountPaymentId,
      addons: data.addons,
      billingPeriod: data.billingPeriod,
    });

    return {
      payment_id: pixResult.payment.id,
      qr_code: pixResult.qrCode.encodedImage,
      payload: pixResult.qrCode.payload,
      expiration_date: pixResult.qrCode.expirationDate,
    };
  };

  private readonly processCreditCardPayment = async (data: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    customer: { user_customer_id: string; user_customer: string };
    planId: string;
    totalAmount: number;
    orderId: string;
    billingPeriod: 'monthly' | 'annual';
    addons: Array<{ plan_cross_sell_id: string }>;
    remoteIp: string;
    input: CreateOrderPaymentRequest;
  }) => {
    if (data.input.billing_period !== 'annual' && data.input.installments) {
      throw new Error(data.t('installments_only_for_annual_plans'));
    }

    if (
      data.input.installments &&
      (data.input.installments < 1 || data.input.installments > 12)
    ) {
      throw new Error(data.t('installments_must_be_between_1_and_12'));
    }

    const billingPeriodId = this.planService.getBillingPeriodId(
      data.billingPeriod
    );
    if (!billingPeriodId) {
      throw new Error(data.t('billing_period_not_found'));
    }

    const creditCardResult = await this.paymentService.createCreditCardPayment(
      data.accountId,
      data.customer.user_customer,
      data.totalAmount,
      `Pagamento do plano ${data.planId}`,
      data.orderId,
      data.remoteIp,
      {
        creditCardId: data.input.credit_card_id,
        newCard: data.input.new_card,
        installments: data.input.installments,
        recurringPayment: data.input.recurring_payment || false,
      }
    );

    if (!creditCardResult.payment?.id) {
      throw new Error(data.t('credit_card_payment_creation_failed'));
    }

    const paymentId = creditCardResult.payment.id;

    const paymentStatus = this.mapAsaasStatusToPaymentStatus(
      creditCardResult.payment.status
    );

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId: data.accountId,
      userCustomerId: data.customer.user_customer_id,
      planId: data.planId,
      billing: paymentId,
      paymentBillingTypeId: EPaymentBillingType.credit_card,
      value: data.totalAmount.toString(),
      netValue: creditCardResult.payment.netValue.toString(),
      pixTransaction: null,
      paymentStatusId: paymentStatus,
      billingPeriodId,
      invoiceUrl: creditCardResult.payment.invoiceUrl || null,
      recurringPayment: data.input.recurring_payment || false,
      userCardId:
        data.input.credit_card_id || creditCardResult.userCardId || null,
      installment: data.input.installments
        ? data.input.installments.toString()
        : null,
    });

    await this.planService.createAccountPaymentCrossSells({
      accountPaymentId,
      addons: data.addons,
      billingPeriod: data.billingPeriod,
    });

    if (this.isAsaasPaymentSuccessful(creditCardResult.payment.status)) {
      const paymentDate =
        creditCardResult.payment.paymentDate || new Date().toISOString();

      try {
        await this.planReleaseService.releasePlanForCreditCard({
          accountPaymentId,
          accountId: data.accountId,
          planId: data.planId,
          billingPeriodId,
          recurringPayment: data.input.recurring_payment || false,
          value: data.totalAmount.toString(),
          paymentDate,
          paymentStatusId: paymentStatus,
        });
      } catch (error) {
        console.error(
          'Erro ao liberar plano para pagamento com cartão de crédito:',
          error
        );
      }
    }

    return {
      payment_id: creditCardResult.payment.id,
      status: creditCardResult.payment.status,
      is_confirmed: this.isAsaasPaymentSuccessful(
        creditCardResult.payment.status
      ),
    };
  };

  private readonly processBoletoPayment = async (data: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    customer: { user_customer_id: string; user_customer: string };
    planId: string;
    totalAmount: number;
    orderId: string;
    billingPeriod: 'monthly' | 'annual';
    addons: Array<{ plan_cross_sell_id: string }>;
  }) => {
    const billingPeriodId = this.planService.getBillingPeriodId(
      data.billingPeriod
    );
    if (!billingPeriodId) {
      throw new Error(data.t('billing_period_not_found'));
    }

    const boletoResult = await this.paymentService.createBoletoPayment(
      data.customer.user_customer,
      data.totalAmount,
      `Pagamento do plano ${data.planId}`,
      data.orderId,
      data.accountId
    );

    if (!boletoResult.payment?.id || !boletoResult.identificationField) {
      throw new Error(data.t('boleto_payment_creation_failed'));
    }

    const paymentStatus = EPaymentStatus.pending;

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId: data.accountId,
      userCustomerId: data.customer.user_customer_id,
      planId: data.planId,
      billing: boletoResult.payment.id,
      paymentBillingTypeId: EPaymentBillingType.boleto,
      value: data.totalAmount.toString(),
      netValue: boletoResult.payment.netValue.toString(),
      pixTransaction: null,
      paymentStatusId: paymentStatus,
      billingPeriodId,
      invoiceUrl: boletoResult.payment.invoiceUrl || null,
      recurringPayment: false,
      boleto: boletoResult.identificationField.identificationField,
      boletoNumber: boletoResult.identificationField.nossoNumero,
      boletoPdf: boletoResult.payment.bankSlipUrl || null,
    });

    await this.planService.createAccountPaymentCrossSells({
      accountPaymentId,
      addons: data.addons,
      billingPeriod: data.billingPeriod,
    });

    return {
      payment_id: boletoResult.payment.id,
      identification_field:
        boletoResult.identificationField.identificationField,
      nosso_numero: boletoResult.identificationField.nossoNumero,
      qr_code: boletoResult.pixQrCode?.encodedImage || undefined,
      payload: boletoResult.pixQrCode?.payload || undefined,
      expiration_date: boletoResult.pixQrCode?.expirationDate || undefined,
      bank_slip_url: boletoResult.payment.bankSlipUrl || '',
      due_date: boletoResult.payment.dueDate,
    };
  };
}
