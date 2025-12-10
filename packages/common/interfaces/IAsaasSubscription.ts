import {
  IAsaasPaymentDiscount,
  IAsaasPaymentInterest,
  IAsaasPaymentFine,
  IAsaasPaymentCallback,
  PaymentBillingTypeResponse,
  IAsaasCreditCardRequest,
  IAsaasCreditCardHolderInfo,
  IAsaasPaymentCreditCard,
  PaymentStatus,
  IListAsaasPaymentsResponse,
} from './IAsaasPayment';

export type SubscriptionBillingType =
  | 'UNDEFINED'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'PIX';

export type SubscriptionCycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'BIMONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUALLY'
  | 'YEARLY';

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'INACTIVE';

export type SubscriptionSplitStatus = 'ACTIVE' | 'DISABLED';

export type SubscriptionSplitDisabledReason =
  | 'WALLET_UNABLE_TO_RECEIVE'
  | 'VALUE_DIVERGENCE';

export interface IAsaasSubscriptionSplitRequest {
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  externalReference?: string;
  description?: string;
}

export interface IAsaasSubscriptionSplitResponse {
  walletId: string;
  fixedValue?: number;
  percentualValue?: number;
  externalReference?: string;
  description?: string;
  status?: SubscriptionSplitStatus;
  disabledReason?: SubscriptionSplitDisabledReason;
}

export interface IAsaasPaymentDiscountResponse {
  value: number;
  dueDateLimitDays: number;
  type: 'FIXED' | 'PERCENTAGE';
}

export interface IAsaasPaymentFineResponse {
  value: number;
}

export interface IAsaasPaymentInterestResponse {
  value: number;
}

export interface ICreateAsaasSubscriptionRequest {
  customer: string;
  billingType: SubscriptionBillingType;
  value: number;
  nextDueDate: string;
  cycle: SubscriptionCycle;
  description?: string;
  endDate?: string;
  maxPayments?: number;
  externalReference?: string;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  split?: IAsaasSubscriptionSplitRequest[];
  callback?: IAsaasPaymentCallback;
}

export interface ICreateAsaasSubscriptionResponse {
  object: string;
  id: string;
  dateCreated: string;
  customer: string;
  paymentLink?: string | null;
  billingType: PaymentBillingTypeResponse;
  cycle: SubscriptionCycle;
  value: number;
  nextDueDate: string;
  endDate?: string;
  description?: string;
  status: SubscriptionStatus;
  discount?: IAsaasPaymentDiscountResponse;
  fine?: IAsaasPaymentFineResponse;
  interest?: IAsaasPaymentInterestResponse;
  deleted: boolean;
  maxPayments?: number;
  externalReference?: string;
  checkoutSession?: string;
  split?: IAsaasSubscriptionSplitResponse[];
}

export type IAsaasSubscriptionItem = ICreateAsaasSubscriptionResponse;

export interface IListAsaasSubscriptionsRequest {
  offset?: number;
  limit?: number;
  customer?: string;
  customerGroupName?: string;
  billingType?: PaymentBillingTypeResponse;
  status?: SubscriptionStatus;
  deletedOnly?: boolean;
  includeDeleted?: boolean;
  externalReference?: string;
  order?: string;
  sort?: string;
}

export interface IListAsaasSubscriptionsResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasSubscriptionItem[];
}

export interface ICreateAsaasSubscriptionWithCreditCardRequest {
  customer: string;
  billingType: SubscriptionBillingType;
  value: number;
  nextDueDate: string;
  cycle: SubscriptionCycle;
  description?: string;
  endDate?: string;
  maxPayments?: number;
  externalReference?: string;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  split?: IAsaasSubscriptionSplitRequest[];
  callback?: IAsaasPaymentCallback;
  creditCard?: IAsaasCreditCardRequest;
  creditCardHolderInfo?: IAsaasCreditCardHolderInfo;
  creditCardToken?: string;
  remoteIp: string;
}

export interface ICreateAsaasSubscriptionWithCreditCardResponse extends ICreateAsaasSubscriptionResponse {
  creditCard?: IAsaasPaymentCreditCard;
}

export type SubscriptionUpdateStatus = 'ACTIVE' | 'INACTIVE';

export interface IUpdateAsaasSubscriptionRequest {
  billingType?: SubscriptionBillingType;
  status?: SubscriptionUpdateStatus;
  nextDueDate?: string;
  discount?: IAsaasPaymentDiscount;
  interest?: IAsaasPaymentInterest;
  fine?: IAsaasPaymentFine;
  cycle?: SubscriptionCycle;
  description?: string;
  endDate?: string;
  updatePendingPayments?: boolean;
  externalReference?: string;
  split?: IAsaasSubscriptionSplitRequest[];
  callback?: IAsaasPaymentCallback;
}

export type IUpdateAsaasSubscriptionResponse = ICreateAsaasSubscriptionResponse;

export interface IDeleteAsaasSubscriptionResponse {
  deleted: boolean;
  id: string;
}

export interface IUpdateAsaasSubscriptionCreditCardRequest {
  creditCard?: IAsaasCreditCardRequest;
  creditCardHolderInfo?: IAsaasCreditCardHolderInfo;
  creditCardToken?: string;
  remoteIp: string;
}

export type IUpdateAsaasSubscriptionCreditCardResponse =
  ICreateAsaasSubscriptionResponse;

export interface IListAsaasSubscriptionPaymentsRequest {
  status?: PaymentStatus;
}

export type IListAsaasSubscriptionPaymentsResponse = IListAsaasPaymentsResponse;

export type SubscriptionPaymentBookOrder = 'asc' | 'desc';

export interface IGetAsaasSubscriptionPaymentBookRequest {
  month?: number;
  year?: number;
  sort?: string;
  order?: SubscriptionPaymentBookOrder;
}

export type InvoiceEffectiveDatePeriod =
  | 'ON_PAYMENT_CONFIRMATION'
  | 'ON_PAYMENT_DUE_DATE'
  | 'BEFORE_PAYMENT_DUE_DATE'
  | 'ON_DUE_DATE_MONTH'
  | 'ON_NEXT_MONTH';

export interface IAsaasInvoiceTaxes {
  retainIss: boolean;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
  pis: number;
  iss: number;
}

export interface ICreateAsaasSubscriptionInvoiceSettingsRequest {
  municipalServiceId?: string;
  municipalServiceCode?: string;
  municipalServiceName?: string;
  updatePayment?: boolean;
  deductions?: number;
  effectiveDatePeriod?: InvoiceEffectiveDatePeriod;
  receivedOnly?: boolean;
  daysBeforeDueDate?: number;
  observations?: string;
  taxes: IAsaasInvoiceTaxes;
}

export interface ICreateAsaasSubscriptionInvoiceSettingsResponse {
  municipalServiceId?: string;
  municipalServiceCode?: string;
  municipalServiceName?: string;
  deductions?: number;
  invoiceCreationPeriod?: InvoiceEffectiveDatePeriod;
  daysBeforeDueDate?: number;
  receivedOnly?: boolean;
  observations?: string;
  taxes: IAsaasInvoiceTaxes;
}

export interface IDeleteAsaasSubscriptionInvoiceSettingsResponse {
  deleted: boolean;
  id: string;
}

export interface IUpdateAsaasSubscriptionInvoiceSettingsRequest {
  deductions?: number;
  effectiveDatePeriod?: InvoiceEffectiveDatePeriod;
  receivedOnly?: boolean;
  daysBeforeDueDate?: number;
  observations?: string;
  taxes: IAsaasInvoiceTaxes;
}

export type IUpdateAsaasSubscriptionInvoiceSettingsResponse =
  ICreateAsaasSubscriptionInvoiceSettingsResponse;

export type InvoiceStatus =
  | 'SCHEDULED'
  | 'WAITING_OVERDUE_PAYMENT'
  | 'PENDING'
  | 'SYNCHRONIZED'
  | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION'
  | 'CANCELLED'
  | 'CANCELLATION_DENIED'
  | 'ERROR'
  | 'NONE'
  | 'CANCELED';

export type InvoiceType = 'NFS-e';

export type InvoiceResponseStatus =
  | 'SCHEDULED'
  | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION'
  | 'CANCELED'
  | 'CANCELLATION_DENIED'
  | 'ERROR';

export interface IAsaasInvoiceItem {
  object: string;
  id: string;
  status: InvoiceResponseStatus;
  customer: string;
  payment: string;
  installment?: string | null;
  type: InvoiceType;
  statusDescription?: string | null;
  serviceDescription?: string;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  rpsSerie?: string | null;
  rpsNumber?: string | null;
  number?: string | null;
  validationCode?: string | null;
  value: number;
  deductions?: number;
  effectiveDate: string;
  observations?: string;
  estimatedTaxesDescription?: string | null;
  externalReference?: string | null;
  taxes: IAsaasInvoiceTaxes;
  municipalServiceId?: string | null;
  municipalServiceCode?: string;
  municipalServiceName?: string;
}

export interface IListAsaasSubscriptionInvoicesRequest {
  offset?: number;
  limit?: number;
  'effectiveDate[ge]'?: string;
  'effectiveDate[le]'?: string;
  externalReference?: string;
  status?: InvoiceStatus;
  customer?: string;
}

export interface IListAsaasSubscriptionInvoicesResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasInvoiceItem[];
}
