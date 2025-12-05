import { injectable } from 'tsyringe';
import {
  GetPaymentStatusService,
  GetPaymentIdentificationFieldService,
  GetPaymentPixQrCodeService,
  GetPaymentBillingInfoService,
  GetPaymentViewingInfoService,
} from './payments';

@injectable()
export class AsaasPaymentInfoServices {
  public readonly getStatus: GetPaymentStatusService;
  public readonly getIdentificationField: GetPaymentIdentificationFieldService;
  public readonly getPixQrCode: GetPaymentPixQrCodeService;
  public readonly getBillingInfo: GetPaymentBillingInfoService;
  public readonly getViewingInfo: GetPaymentViewingInfoService;

  constructor(
    getStatus: GetPaymentStatusService,
    getIdentificationField: GetPaymentIdentificationFieldService,
    getPixQrCode: GetPaymentPixQrCodeService,
    getBillingInfo: GetPaymentBillingInfoService,
    getViewingInfo: GetPaymentViewingInfoService
  ) {
    this.getStatus = getStatus;
    this.getIdentificationField = getIdentificationField;
    this.getPixQrCode = getPixQrCode;
    this.getBillingInfo = getBillingInfo;
    this.getViewingInfo = getViewingInfo;
  }
}
