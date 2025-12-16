import { injectable } from 'tsyringe';
import { sendTwoFactor } from './methods/sendTwoFactor';
import { verifyCode } from './methods/verifyCode';

@injectable()
class RegisterController {
  public sendTwoFactor = sendTwoFactor;
  public verifyCode = verifyCode;
}

export default RegisterController;
