import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListRoleRequest } from '@core/schema/role/listRole/request.schema';
import { ListRoleFinalResponse } from '@core/schema/role/listRole/response.schema';
import { RoleService } from '@core/services/role.service';

@injectable()
export class RoleListerUseCase {
  constructor(private readonly roleService: RoleService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListRoleRequest,
    accountId: string
  ): Promise<ListRoleFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.roleService.listRoles(
      perPage,
      currentPage,
      query,
      accountId
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
