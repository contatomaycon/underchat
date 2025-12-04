import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewDocumentResponse } from '@core/schema/accountSettings/viewDocument/response.schema';

@injectable()
export class AccountSettingsDocumentViewerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewDocumentResponse | null> {
    const rawData = await this.userService.getUserSensitiveDataRaw(userId);

    if (!rawData) {
      throw new Error(t('user_not_found'));
    }

    const document = this.userService.getUserDocumentDecrypted(
      rawData.document
    );

    return {
      document,
    };
  }
}
