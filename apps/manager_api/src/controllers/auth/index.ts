import { injectable } from 'tsyringe';
import { login } from '@/controllers/auth/methods/login';
import { refreshToken } from './methods/refreshToken';
import { logout } from './methods/logout';
import { forgotPasswordSendCode } from './methods/forgotPasswordSendCode';
import { forgotPasswordVerifyCode } from './methods/forgotPasswordVerifyCode';
import { forgotPasswordResetPassword } from './methods/forgotPasswordResetPassword';

@injectable()
class AuthController {
  public login = login;
  public refreshToken = refreshToken;
  public logout = logout;
  public forgotPasswordSendCode = forgotPasswordSendCode;
  public forgotPasswordVerifyCode = forgotPasswordVerifyCode;
  public forgotPasswordResetPassword = forgotPasswordResetPassword;
}

export default AuthController;
