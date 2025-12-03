export type PaymentLinkBillingType =
  | 'UNDEFINED'
  | 'BOLETO'
  | 'CREDIT_CARD'
  | 'PIX';

export type PaymentLinkChargeType = 'DETACHED' | 'RECURRENT' | 'INSTALLMENT';

export type PaymentLinkCycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'BIMONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUALLY'
  | 'YEARLY';

export interface IAsaasPaymentLinkCallback {
  successUrl: string;
  autoRedirect?: boolean;
}

export interface ICreateAsaasPaymentLinkRequest {
  name: string;
  billingType: PaymentLinkBillingType;
  chargeType: PaymentLinkChargeType;
  description?: string;
  endDate?: string;
  value?: number;
  dueDateLimitDays?: number;
  subscriptionCycle?: PaymentLinkCycle;
  maxInstallmentCount?: number;
  externalReference?: string;
  notificationEnabled?: boolean;
  callback?: IAsaasPaymentLinkCallback;
  isAddressRequired?: boolean;
}

export interface ICreateAsaasPaymentLinkResponse {
  id: string;
  name: string;
  value?: number;
  active: boolean;
  chargeType: PaymentLinkChargeType;
  url: string;
  billingType: PaymentLinkBillingType;
  subscriptionCycle?: PaymentLinkCycle;
  description?: string;
  endDate?: string;
  deleted: boolean;
  viewCount: number;
  maxInstallmentCount?: number;
  dueDateLimitDays?: number;
  notificationEnabled: boolean;
  isAddressRequired: boolean;
  externalReference?: string;
}

export type IAsaasPaymentLinkItem = ICreateAsaasPaymentLinkResponse;

export interface IListAsaasPaymentLinksRequest {
  offset?: number;
  limit?: number;
  active?: boolean;
  includeDeleted?: boolean;
  name?: string;
  externalReference?: string;
}

export interface IListAsaasPaymentLinksResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasPaymentLinkItem[];
}

export interface IUpdateAsaasPaymentLinkRequest {
  name?: string;
  description?: string;
  endDate?: string;
  value?: number;
  active?: boolean;
  billingType?: PaymentLinkBillingType;
  chargeType?: PaymentLinkChargeType;
  dueDateLimitDays?: number;
  subscriptionCycle?: PaymentLinkCycle;
  maxInstallmentCount?: number;
  externalReference?: string;
  notificationEnabled?: boolean;
  callback?: IAsaasPaymentLinkCallback;
}

export type IUpdateAsaasPaymentLinkResponse = ICreateAsaasPaymentLinkResponse;

export interface IDeleteAsaasPaymentLinkResponse {
  deleted: boolean;
  id: string;
}

export type IRestoreAsaasPaymentLinkResponse = ICreateAsaasPaymentLinkResponse;

export interface IAsaasPaymentLinkImageFile {
  originalName: string;
  size: number;
  extension: string;
  previewUrl: string;
  downloadUrl: string;
}

export interface IUploadAsaasPaymentLinkImageRequest {
  image: File | Blob;
  main?: boolean;
}

export interface IUploadAsaasPaymentLinkImageResponse {
  id: string;
  main: boolean;
  image: IAsaasPaymentLinkImageFile;
}

export type IAsaasPaymentLinkImageItem = IUploadAsaasPaymentLinkImageResponse;

export interface IListAsaasPaymentLinkImagesResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasPaymentLinkImageItem[];
}

export interface IDeleteAsaasPaymentLinkImageResponse {
  deleted: boolean;
  id: string;
}

export type ISetAsMainPaymentLinkImageResponse =
  IUploadAsaasPaymentLinkImageResponse;
