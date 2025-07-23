import { injectable } from 'tsyringe';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/auth copy/PermissionAssignmentUserViewer.repository';

@injectable()
export class PermissionService {
  constructor(
    private readonly permissionAssignmentUserViewerRepository: PermissionAssignmentUserViewerRepository
  ) {}

  viewPermissionByUserId = async (userId: number): Promise<string[]> => {
    const result =
      await this.permissionAssignmentUserViewerRepository.viewPermissionByUserId(
        userId
      );

    return result.map((item) => item.action);
  };
}
