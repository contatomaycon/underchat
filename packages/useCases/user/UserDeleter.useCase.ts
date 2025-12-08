import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { StorageService } from '@core/services/storage.service';

@injectable()
export class UserDeleterUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly storageService: StorageService
  ) {}

  private async deleteUserPhotoFromStorage(userId: string): Promise<void> {
    const userPhoto = await this.userService.viewUserNamePhoto(userId);
    if (!userPhoto?.photo) {
      return;
    }

    await this.storageService.deleteImage(userPhoto.photo);
  }

  private async validateUserExistsInAccount(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string
  ): Promise<void> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }
  }

  private async validateUserExists(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<string> {
    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    return userAccountId;
  }

  private resolveAccountId(
    accountId: string,
    canOperateOnOthers: boolean,
    userAccountId?: string | null
  ): string {
    if (!canOperateOnOthers) {
      return accountId;
    }

    return userAccountId ?? accountId;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<boolean> {
    if (!canOperateOnOthers) {
      await this.validateUserExistsInAccount(t, userId, accountId);
    }

    let userAccountId: string | null = null;
    if (canOperateOnOthers) {
      userAccountId = await this.validateUserExists(t, userId);
    }

    await this.deleteUserPhotoFromStorage(userId);

    const accountIdToUse = this.resolveAccountId(
      accountId,
      canOperateOnOthers,
      userAccountId
    );

    if (!accountIdToUse) {
      throw new Error(t('user_not_found'));
    }

    const deleteUserById = await this.userService.deleteUserById(
      userId,
      accountIdToUse
    );

    if (!deleteUserById) {
      throw new Error(t('user_deleter_error'));
    }

    return true;
  }
}
