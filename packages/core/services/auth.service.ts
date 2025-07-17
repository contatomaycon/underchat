import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { injectable } from 'tsyringe';
import { EncryptService } from './encrypt.service';

@injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly encryptService: EncryptService
  ) {}

  authenticate = async (email: string, password: string) => {
    const passwordEncrypted = this.encryptService.encrypt(password);

    return this.authRepository.authenticate(email, passwordEncrypted);
  };
}
