import {
  IAsaasCreditCardRequest,
  IAsaasCreditCardHolderInfo,
} from './IAsaasPayment';

export type CreditCardBrand =
  | 'VISA'
  | 'MASTERCARD'
  | 'ELO'
  | 'DINERS'
  | 'DISCOVER'
  | 'AMEX'
  | 'CABAL'
  | 'BANESCARD'
  | 'CREDZ'
  | 'SOROCRED'
  | 'CREDSYSTEM'
  | 'JCB'
  | 'UNKNOWN';

export interface ITokenizeAsaasCreditCardRequest {
  customer: string;
  creditCard: IAsaasCreditCardRequest;
  creditCardHolderInfo: IAsaasCreditCardHolderInfo;
  remoteIp: string;
}

export interface ITokenizeAsaasCreditCardResponse {
  creditCardNumber: string;
  creditCardBrand: CreditCardBrand;
  creditCardToken: string;
}
