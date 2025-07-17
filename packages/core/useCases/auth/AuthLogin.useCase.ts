import { AuthService } from '@core/services/auth.service';
import { injectable } from 'tsyringe';
import { AuthLoginResponse } from '@core/schema/auth/login/response.schema';
import { AuthLoginRequest } from '@core/schema/auth/login/request.schema';

@injectable()
export class AuthLoginUseCase {
  constructor(private readonly authService: AuthService) {}

  async execute(input: AuthLoginRequest): Promise<AuthLoginResponse | null> {
    return this.authService.authenticate(input.login, input.password);
  }
}
