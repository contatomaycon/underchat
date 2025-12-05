import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PaymentService } from '@core/services/payment.service';
import { PlanService } from '@core/services/plan.service';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import { EPaymentBillingType } from '@core/common/enums/EPaymentBillingType';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { PlanReleaseService } from '@core/services/planRelease.service';
import { randomUUID } from 'crypto';

@injectable()
export class OrderPaymentCreatorUseCase {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly planService: PlanService,
    private readonly planReleaseService: PlanReleaseService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateOrderPaymentRequest,
    remoteIp: string
  ): Promise<CreateOrderPaymentResponse> => {
    try {
      const customer = await this.paymentService.getOrCreateCustomer(accountId);
      if (!customer) {
        throw new Error(t('customer_not_found_or_could_not_create'));
      }

      const { planPrice, addonsTotal, discountAmount, totalAmount } =
        await this.planService.calculateOrderPayment(accountId, input);

      const orderId = randomUUID();

      const pixPaymentData =
        input.payment_method === 'pix'
          ? await this.processPixPayment(
              t,
              accountId,
              customer,
              input.plan_id,
              totalAmount,
              orderId,
              input.billing_period,
              input.addons || []
            )
          : undefined;

      const creditCardPaymentData =
        input.payment_method === 'credit_card'
          ? await this.processCreditCardPayment(
              t,
              accountId,
              customer,
              input.plan_id,
              totalAmount,
              orderId,
              input.billing_period,
              input.addons || [],
              remoteIp,
              input
            )
          : undefined;

      const boletoPaymentData =
        input.payment_method === 'boleto'
          ? await this.processBoletoPayment(
              t,
              accountId,
              customer,
              input.plan_id,
              totalAmount,
              orderId,
              input.billing_period,
              input.addons || []
            )
          : undefined;

      const result: CreateOrderPaymentResponse = {
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

      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(t('order_payment_creation_failed'));
    }
  };

  private readonly processPixPayment = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    customer: { user_customer_id: string; user_customer: string },
    planId: string,
    totalAmount: number,
    orderId: string,
    billingPeriod: 'monthly' | 'annual',
    addons: Array<{ plan_cross_sell_id: string }>
  ) => {
    const billingPeriodId = this.planService.getBillingPeriodId(billingPeriod);
    if (!billingPeriodId) {
      throw new Error(t('billing_period_not_found'));
    }

    const pixResult = await this.paymentService.createPixPayment(
      customer.user_customer,
      totalAmount,
      `Pagamento do plano ${planId}`,
      orderId
    );

    if (!pixResult.payment || !pixResult.qrCode) {
      throw new Error(t('pix_payment_creation_failed'));
    }

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId,
      userCustomerId: customer.user_customer_id,
      planId,
      billing: pixResult.payment.id,
      paymentBillingTypeId: EPaymentBillingType.pix,
      value: totalAmount.toString(),
      netValue: pixResult.payment.netValue.toString(),
      pixTransaction: pixResult.payment.pixTransaction || null,
      paymentStatusId: EPaymentStatus.pending,
      billingPeriodId,
      invoiceUrl: pixResult.payment.invoiceUrl || null,
      recurringPayment: false,
    });

    await this.planService.createAccountPaymentCrossSells({
      accountPaymentId,
      addons,
      billingPeriod,
    });

    return {
      payment_id: pixResult.payment.id,
      qr_code: pixResult.qrCode.encodedImage,
      payload: pixResult.qrCode.payload,
      expiration_date: pixResult.qrCode.expirationDate,
    };
  };

  private readonly processCreditCardPayment = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    customer: { user_customer_id: string; user_customer: string },
    planId: string,
    totalAmount: number,
    orderId: string,
    billingPeriod: 'monthly' | 'annual',
    addons: Array<{ plan_cross_sell_id: string }>,
    remoteIp: string,
    input: CreateOrderPaymentRequest
  ) => {
    if (input.billing_period !== 'annual' && input.installments) {
      throw new Error(t('installments_only_for_annual_plans'));
    }

    if (
      input.installments &&
      (input.installments < 1 || input.installments > 12)
    ) {
      throw new Error(t('installments_must_be_between_1_and_12'));
    }

    const billingPeriodId = this.planService.getBillingPeriodId(billingPeriod);
    if (!billingPeriodId) {
      throw new Error(t('billing_period_not_found'));
    }

    const creditCardResult = await this.paymentService.createCreditCardPayment(
      accountId,
      customer.user_customer,
      totalAmount,
      `Pagamento do plano ${planId}`,
      orderId,
      remoteIp,
      {
        creditCardId: input.credit_card_id,
        newCard: input.new_card,
        installments: input.installments,
        recurringPayment: input.recurring_payment || false,
      }
    );

    if (!creditCardResult.payment || !creditCardResult.payment.id) {
      throw new Error(t('credit_card_payment_creation_failed'));
    }

    const paymentId = creditCardResult.payment.id;

    const paymentStatus =
      creditCardResult.payment.status === 'CONFIRMED' ||
      creditCardResult.payment.status === 'RECEIVED'
        ? EPaymentStatus.received
        : EPaymentStatus.pending;

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId,
      userCustomerId: customer.user_customer_id,
      planId,
      billing: paymentId,
      paymentBillingTypeId: EPaymentBillingType.credit_card,
      value: totalAmount.toString(),
      netValue: creditCardResult.payment.netValue.toString(),
      pixTransaction: null,
      paymentStatusId: paymentStatus,
      billingPeriodId,
      invoiceUrl: creditCardResult.payment.invoiceUrl || null,
      recurringPayment: input.recurring_payment || false,
      userCardId: input.credit_card_id || creditCardResult.userCardId || null,
      installment: input.installments ? input.installments.toString() : null,
    });

    await this.planService.createAccountPaymentCrossSells({
      accountPaymentId,
      addons,
      billingPeriod,
    });

    if (paymentStatus === EPaymentStatus.received) {
      const paymentDate =
        creditCardResult.payment.paymentDate || new Date().toISOString();

      try {
        await this.planReleaseService.releasePlanForCreditCard({
          accountPaymentId,
          accountId,
          planId,
          billingPeriodId,
          recurringPayment: input.recurring_payment || false,
          value: totalAmount.toString(),
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
      is_confirmed: paymentStatus === EPaymentStatus.received,
    };
  };

  private readonly processBoletoPayment = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    customer: { user_customer_id: string; user_customer: string },
    planId: string,
    totalAmount: number,
    orderId: string,
    billingPeriod: 'monthly' | 'annual',
    addons: Array<{ plan_cross_sell_id: string }>
  ) => {
    const billingPeriodId = this.planService.getBillingPeriodId(billingPeriod);
    if (!billingPeriodId) {
      throw new Error(t('billing_period_not_found'));
    }

    const boletoResult = await this.paymentService.createBoletoPayment(
      customer.user_customer,
      totalAmount,
      `Pagamento do plano ${planId}`,
      orderId
    );

    if (!boletoResult.payment || !boletoResult.identificationField) {
      throw new Error(t('boleto_payment_creation_failed'));
    }

    const paymentStatus = EPaymentStatus.pending;

    const accountPaymentId = await this.planService.createAccountPayment({
      accountId,
      userCustomerId: customer.user_customer_id,
      planId,
      billing: boletoResult.payment.id,
      paymentBillingTypeId: EPaymentBillingType.boleto,
      value: totalAmount.toString(),
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
      addons,
      billingPeriod,
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
