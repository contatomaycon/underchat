import { injectable } from 'tsyringe';
import {
  CaptureAuthorizedPaymentService,
  PayWithCreditCardService,
} from './payments';

@injectable()
export class AsaasPaymentActionServices {
  public readonly captureAuthorized: CaptureAuthorizedPaymentService;
  public readonly payWithCreditCard: PayWithCreditCardService;

  constructor(
    captureAuthorized: CaptureAuthorizedPaymentService,
    payWithCreditCard: PayWithCreditCardService
  ) {
    this.captureAuthorized = captureAuthorized;
    this.payWithCreditCard = payWithCreditCard;
  }
}
