import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PaymentService } from '@core/services/payment.service';
import { OrderPaymentCreatorRepository } from '@core/repositories/plan/OrderPaymentCreator.repository';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import { EPaymentBillingType } from '@core/common/enums/EPaymentBillingType';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { randomUUID } from 'crypto';

@injectable()
export class OrderPaymentCreatorUseCase {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly orderPaymentCreatorRepository: OrderPaymentCreatorRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateOrderPaymentRequest
  ): Promise<CreateOrderPaymentResponse> => {
    try {
      const customer = await this.paymentService.getOrCreateCustomer(accountId);
      if (!customer) {
        throw new Error(t('customer_not_found_or_could_not_create'));
      }

      const { planPrice, addonsTotal, discountAmount, totalAmount } =
        await this.orderPaymentCreatorRepository.calculateOrderPayment(
          accountId,
          input
        );

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
              input.billing_period
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
    billingPeriod: 'monthly' | 'annual'
  ) => {
    const billingPeriodId =
      this.orderPaymentCreatorRepository.getBillingPeriodId(billingPeriod);
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

    await this.orderPaymentCreatorRepository.createAccountPayment({
      accountId,
      userCustomerId: customer.user_customer_id,
      planId,
      billing: pixResult.payment.id,
      paymentBillingTypeId: EPaymentBillingType.pix,
      value: totalAmount.toString(),
      netValue: pixResult.payment.netValue.toString(),
      pixTransaction: pixResult.payment.pixTransaction || null,
      pixQrCodeId: pixResult.payment.pixQrCodeId || null,
      paymentStatusId: EPaymentStatus.pending,
      billingPeriodId,
      invoiceUrl: pixResult.payment.invoiceUrl || null,
      recurringPayment: false,
    });

    return {
      qr_code: pixResult.qrCode.encodedImage,
      payload: pixResult.qrCode.payload,
      expiration_date: pixResult.qrCode.expirationDate,
    };
  };
}
