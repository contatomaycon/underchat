import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserDocumentResponse } from '@core/schema/user/viewUserDocument/response.schema';

@injectable()
export class UserDocumentViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewUserDocumentResponse | null> {
    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);

    if (!sensitiveData) {
      throw new Error(t('user_not_found'));
    }

    return {
      document: sensitiveData.document,
    };
  }
}
