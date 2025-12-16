import { injectable } from 'tsyringe';
import { sendTwoFactor } from './methods/sendTwoFactor';
import { verifyCode } from './methods/verifyCode';
import { viewZipcode } from './methods/viewZipcode';

@injectable()
class RegisterController {
  public sendTwoFactor = sendTwoFactor;
  public verifyCode = verifyCode;
  public viewZipcode = viewZipcode;
}

export default RegisterController;
