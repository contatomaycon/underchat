import { injectable, inject } from 'tsyringe';
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
    @inject(GetPaymentStatusService)
    getStatus: GetPaymentStatusService,
    @inject(GetPaymentIdentificationFieldService)
    getIdentificationField: GetPaymentIdentificationFieldService,
    @inject(GetPaymentPixQrCodeService)
    getPixQrCode: GetPaymentPixQrCodeService,
    @inject(GetPaymentBillingInfoService)
    getBillingInfo: GetPaymentBillingInfoService,
    @inject(GetPaymentViewingInfoService)
    getViewingInfo: GetPaymentViewingInfoService
  ) {
    this.getStatus = getStatus;
    this.getIdentificationField = getIdentificationField;
    this.getPixQrCode = getPixQrCode;
    this.getBillingInfo = getBillingInfo;
    this.getViewingInfo = getViewingInfo;
  }
}
