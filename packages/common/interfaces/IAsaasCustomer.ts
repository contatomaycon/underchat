export interface ICreateAsaasCustomerRequest {
  name: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  additionalEmails?: string;
  municipalInscription?: string;
  stateInscription?: string;
  observations?: string;
  groupName?: string;
  company?: string;
  foreignCustomer?: boolean;
}

export interface ICreateAsaasCustomerResponse {
  object: string;
  id: string;
  dateCreated: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  city?: number | null;
  cityName?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  cpfCnpj: string;
  personType?: 'FISICA' | 'JURIDICA' | null;
  deleted?: boolean;
  additionalEmails?: string | null;
  externalReference?: string | null;
  notificationDisabled?: boolean;
  observations?: string | null;
  foreignCustomer?: boolean;
}

export interface IListAsaasCustomersRequest {
  offset?: number;
  limit?: number;
  name?: string;
  email?: string;
  cpfCnpj?: string;
  groupName?: string;
  externalReference?: string;
}

export interface IAsaasCustomerItem {
  object: string;
  id: string;
  dateCreated: string;
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  city?: number;
  cityName?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  cpfCnpj: string;
  personType?: 'FISICA' | 'JURIDICA';
  deleted?: boolean;
  additionalEmails?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  observations?: string;
  foreignCustomer?: boolean;
}

export interface IListAsaasCustomersResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasCustomerItem[];
}

export type IGetAsaasCustomerResponse = IAsaasCustomerItem;

export interface IUpdateAsaasCustomerRequest {
  name?: string;
  cpfCnpj?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
  externalReference?: string;
  notificationDisabled?: boolean;
  additionalEmails?: string;
  municipalInscription?: string;
  stateInscription?: string;
  observations?: string;
  groupName?: string;
  company?: string;
  foreignCustomer?: boolean;
}

export type IUpdateAsaasCustomerResponse = IAsaasCustomerItem;

export interface IDeleteAsaasCustomerResponse {
  deleted: boolean;
  id: string;
}

export type IRestoreAsaasCustomerResponse = IAsaasCustomerItem;

export interface IAsaasNotificationItem {
  object: string;
  id: string;
  customer: string;
  enabled: boolean;
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  event:
    | 'PAYMENT_CREATED'
    | 'PAYMENT_UPDATED'
    | 'PAYMENT_RECEIVED'
    | 'PAYMENT_OVERDUE'
    | 'PAYMENT_DUEDATE_WARNING'
    | 'SEND_LINHA_DIGITAVEL';
  scheduleOffset?: 0 | 1 | 5 | 7 | 10 | 15 | 30;
  deleted?: boolean;
}

export interface IListAsaasCustomerNotificationsResponse {
  object: string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: IAsaasNotificationItem[];
}
