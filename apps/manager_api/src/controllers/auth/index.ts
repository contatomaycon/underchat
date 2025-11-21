import { injectable } from 'tsyringe';
import { login } from '@/controllers/auth/methods/login';
import { refreshToken } from './methods/refreshToken';

@injectable()
class AuthController {
  public login = login;
  public refreshToken = refreshToken;
}

export default AuthController;
