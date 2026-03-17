import type { TFunction } from 'i18next';
import type { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';

export type OrderPaymentOrderType = 'plan' | 'addon';

export interface IOrderPaymentAddonSelection {
  plan_cross_sell_id: string;
  value?: number;
}

export interface IOrderPaymentContext {
  orderType: OrderPaymentOrderType;
  planId: string;
  billingPeriod: 'monthly' | 'annual';
  addons: IOrderPaymentAddonSelection[];
  planPrice: number;
  addonsTotal: number;
  discountAmount: number;
  totalAmount: number;
  recurringPayment: boolean;
}

export interface IOrderPaymentCreditCardFeeInstallmentInput {
  paymentMethod: CreateOrderPaymentRequest['payment_method'];
  billingPeriod: 'monthly' | 'annual';
  installments?: number;
}

export interface IOrderPaymentTestPlan {
  is_test: boolean;
  days_trial: number | null;
}

export interface IOrderPaymentCustomer {
  user_customer_id: string;
  user_customer: string;
}

export interface IOrderPaymentPixInput {
  t: TFunction<'translation', undefined>;
  accountId: string;
  customer: IOrderPaymentCustomer;
  planId: string;
  totalAmount: number;
  orderId: string;
  billingPeriod: 'monthly' | 'annual';
  addons: IOrderPaymentAddonSelection[];
  isAddonOnly: boolean;
}

export interface IOrderPaymentCreditCardInput {
  t: TFunction<'translation', undefined>;
  accountId: string;
  customer: IOrderPaymentCustomer;
  planId: string;
  totalAmount: number;
  orderId: string;
  billingPeriod: 'monthly' | 'annual';
  addons: IOrderPaymentAddonSelection[];
  isAddonOnly: boolean;
  recurringPayment: boolean;
  remoteIp: string;
  input: CreateOrderPaymentRequest;
}

export interface IOrderPaymentBoletoInput {
  t: TFunction<'translation', undefined>;
  accountId: string;
  customer: IOrderPaymentCustomer;
  planId: string;
  totalAmount: number;
  orderId: string;
  billingPeriod: 'monthly' | 'annual';
  addons: IOrderPaymentAddonSelection[];
  isAddonOnly: boolean;
}
