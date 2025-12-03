export type InvoiceStatus =
  | 'SCHEDULED'
  | 'AUTHORIZED'
  | 'PROCESSING_CANCELLATION'
  | 'CANCELED'
  | 'CANCELLATION_DENIED'
  | 'ERROR';

export type InvoiceType = 'NFS-e';

export interface IAsaasInvoiceTaxes {
  retainIss: boolean;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
  pis: number;
  iss: number;
}

export interface ICreateAsaasInvoiceRequest {
  payment?: string;
  installment?: string;
  customer?: string;
  serviceDescription: string;
  observations: string;
  externalReference?: string;
  value: number;
  deductions: number;
  effectiveDate: string;
  municipalServiceId?: string;
  municipalServiceCode?: string;
  municipalServiceName: string;
  updatePayment?: boolean;
  taxes: IAsaasInvoiceTaxes;
}

export interface ICreateAsaasInvoiceResponse {
  object: string;
  id: string;
  status: InvoiceStatus;
  customer: string;
  payment?: string;
  installment?: string | null;
  type: InvoiceType;
  statusDescription?: string | null;
  serviceDescription: string;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  rpsSerie?: string | null;
  rpsNumber?: string | null;
  number?: string | null;
  validationCode?: string | null;
  value: number;
  deductions: number;
  effectiveDate: string;
  observations: string;
  estimatedTaxesDescription?: string | null;
  externalReference?: string | null;
  taxes: IAsaasInvoiceTaxes;
  municipalServiceId?: string | null;
  municipalServiceCode?: string;
  municipalServiceName: string;
}

export type IAsaasInvoiceItem = ICreateAsaasInvoiceResponse;

export interface IListAsaasInvoicesRequest {
  offset?: number;
  limit?: number;
  'effectiveDate[ge]'?: string;
  'effectiveDate[le]'?: string;
  payment?: string;
  installment?: string;
  externalReference?: string;
  status?: InvoiceStatus;
  customer?: string;
}

export interface IListAsaasInvoicesResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasInvoiceItem[];
}

export interface IUpdateAsaasInvoiceRequest {
  serviceDescription?: string;
  observations?: string;
  externalReference?: string;
  value?: number;
  deductions?: number;
  effectiveDate?: string;
  updatePayment?: boolean;
  taxes?: IAsaasInvoiceTaxes;
}

export type IUpdateAsaasInvoiceResponse = ICreateAsaasInvoiceResponse;

export type IGetAsaasInvoiceResponse = ICreateAsaasInvoiceResponse;

export type IAuthorizeAsaasInvoiceResponse = ICreateAsaasInvoiceResponse;

export interface ICancelAsaasInvoiceRequest {
  cancelOnlyOnAsaas?: boolean;
}

export type ICancelAsaasInvoiceResponse = ICreateAsaasInvoiceResponse;
