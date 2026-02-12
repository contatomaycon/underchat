import { injectable, inject } from 'tsyringe';
import {
  CaptureAuthorizedPaymentService,
  PayWithCreditCardService,
} from './payments';

@injectable()
export class AsaasPaymentActionServices {
  public readonly captureAuthorized: CaptureAuthorizedPaymentService;
  public readonly payWithCreditCard: PayWithCreditCardService;

  constructor(
    @inject(CaptureAuthorizedPaymentService)
    captureAuthorized: CaptureAuthorizedPaymentService,
    @inject(PayWithCreditCardService)
    payWithCreditCard: PayWithCreditCardService
  ) {
    this.captureAuthorized = captureAuthorized;
    this.payWithCreditCard = payWithCreditCard;
  }
}
