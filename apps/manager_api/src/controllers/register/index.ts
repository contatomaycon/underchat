import { injectable } from 'tsyringe';
import { sendTwoFactor } from './methods/sendTwoFactor';
import { verifyCode } from './methods/verifyCode';
import { viewZipcode } from './methods/viewZipcode';
import { listStates } from './methods/listStates';
import { listCities } from './methods/listCities';
import { listPlanWithItems } from './methods/listPlanWithItems';
import { listAvailableCrossSell } from './methods/listAvailableCrossSell';
import { listCreditCardFee } from './methods/listCreditCardFee';
import { createOrderPayment } from './methods/createOrderPayment';
import { centrifugoToken } from './methods/centrifugoToken';

@injectable()
class RegisterController {
  public sendTwoFactor = sendTwoFactor;
  public verifyCode = verifyCode;
  public viewZipcode = viewZipcode;
  public listStates = listStates;
  public listCities = listCities;
  public listPlanWithItems = listPlanWithItems;
  public listAvailableCrossSell = listAvailableCrossSell;
  public listCreditCardFee = listCreditCardFee;
  public createOrderPayment = createOrderPayment;
  public centrifugoToken = centrifugoToken;
}

export default RegisterController;
