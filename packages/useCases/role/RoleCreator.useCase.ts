import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { RoleService } from '@core/services/role.service';
import { CreateRoleResponse } from '@core/schema/role/createRole/response.schema';
import { PlanAccountService } from '@core/services/planAccount.service';

@injectable()
export class RoleCreatorUseCase {
  constructor(
    @inject(RoleService)
    private readonly roleService: RoleService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: string,
    accountId: string
  ): Promise<void> {
    const roleExists = await this.roleService.existsRoleByName(
      input,
      accountId
    );

    if (roleExists) {
      throw new Error(t('role_already_exists'));
    }

    await this.planAccountService.validateCanCreateRole(t, accountId);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: string,
    accountId: string,
    description: string | null | undefined
  ): Promise<CreateRoleResponse | null> {
    await this.validate(t, input, accountId);

    const roleCreator = await this.roleService.createRole(
      input,
      accountId,
      description
    );

    if (!roleCreator) {
      throw new Error(t('role_creator_error'));
    }

    return roleCreator;
  }
}
