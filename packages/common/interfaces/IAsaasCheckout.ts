export type CheckoutBillingType = 'CREDIT_CARD' | 'PIX';

export type CheckoutChargeType = 'DETACHED' | 'RECURRENT' | 'INSTALLMENT';

export type CheckoutCycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'BIMONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUALLY'
  | 'YEARLY';

export interface IAsaasCheckoutCallback {
  successUrl: string;
  cancelUrl: string;
  expiredUrl?: string;
}

export interface IAsaasCheckoutItem {
  externalReference?: string;
  description?: string;
  imageBase64: string;
  name: string;
  quantity: number;
  value: number;
}

export interface IAsaasCheckoutCustomerData {
  name?: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
  address?: string;
  addressNumber?: number;
  complement?: string;
  province?: string;
  postalCode?: string;
  city?: number;
}

export interface IAsaasCheckoutSubscription {
  cycle?: CheckoutCycle;
  endDate?: string;
  nextDueDate?: string;
}

export interface IAsaasCheckoutInstallment {
  maxInstallmentCount?: number;
}

export interface IAsaasCheckoutSplit {
  walletId: string;
  fixedValue?: number;
  percentageValue?: number;
  totalFixedValue?: number;
}

export interface ICreateAsaasCheckoutRequest {
  billingTypes: CheckoutBillingType[];
  chargeTypes: CheckoutChargeType[];
  minutesToExpire?: number;
  externalReference?: string;
  callback: IAsaasCheckoutCallback;
  items: IAsaasCheckoutItem[];
  customerData?: IAsaasCheckoutCustomerData;
  subscription?: IAsaasCheckoutSubscription;
  installment?: IAsaasCheckoutInstallment;
  splits?: IAsaasCheckoutSplit[];
}

export interface ICreateAsaasCheckoutResponse {
  billingTypes: CheckoutBillingType[];
  chargeTypes: CheckoutChargeType[];
  minutesToExpire?: number;
  externalReference?: string;
  callback: IAsaasCheckoutCallback;
  items: IAsaasCheckoutItem[];
  customerData?: IAsaasCheckoutCustomerData;
  subscription?: IAsaasCheckoutSubscription;
  installment?: IAsaasCheckoutInstallment;
  split?: IAsaasCheckoutSplit[];
}
