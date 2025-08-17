import { injectable } from 'tsyringe';
import { UserNamePhotoViewerRepository } from '@core/repositories/user/UserNamePhotoViewer.repository';
import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';

@injectable()
export class UserService {
  constructor(
    private readonly userNamePhotoViewerRepository: UserNamePhotoViewerRepository
  ) {}

  viewUserNamePhoto = async (
    userId: string
  ): Promise<IViewUserNamePhoto | null> => {
    return this.userNamePhotoViewerRepository.viewUserNamePhoto(userId);
  };
}
