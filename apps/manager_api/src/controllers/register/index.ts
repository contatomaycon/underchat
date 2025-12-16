import { injectable } from 'tsyringe';
import { sendTwoFactor } from './methods/sendTwoFactor';

@injectable()
class RegisterController {
  public sendTwoFactor = sendTwoFactor;
}

export default RegisterController;
