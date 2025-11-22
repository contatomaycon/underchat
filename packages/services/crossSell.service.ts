import { injectable } from 'tsyringe';
import { ListCrossSellRequest } from '@core/schema/planCrossSell/listCrossSell/request.schema';
import { ListCrossSellResponse } from '@core/schema/planCrossSell/listCrossSell/response.schema';
import { CrossSellListerRepository } from '@core/repositories/planCrossSell/CrossSellLister.repository';
import { CrossSellCreatorRepository } from '@core/repositories/planCrossSell/CrossSellCreator.repository';
import { CrossSellUpdaterRepository } from '@core/repositories/planCrossSell/CrossSellUpdater.repository';
import { CrossSellDeleterTransactionRepository } from '@core/repositories/planCrossSell/CrossSellDeleterTransaction.repository';
import { CrossSellAccountCreatorRepository } from '@core/repositories/planCrossSell/CrossSellAccountCreator.repository';
import { CrossSellAccountListerRepository } from '@core/repositories/planCrossSell/CrossSellAccountLister.repository';
import { CrossSellAccountSingleDeleterRepository } from '@core/repositories/planCrossSell/CrossSellAccountSingleDeleter.repository';
import { CreateCrossSellRequest } from '@core/schema/planCrossSell/createCrossSell/request.schema';
import { UpdateCrossSellRequest } from '@core/schema/planCrossSell/updateCrossSell/request.schema';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';
import { ListCrossSellAccountResponse } from '@core/schema/planCrossSell/listCrossSellAccount/response.schema';
import { TFunction } from 'i18next';

@injectable()
export class CrossSellService {
  constructor(
    private readonly crossSellListerRepository: CrossSellListerRepository,
    private readonly crossSellCreatorRepository: CrossSellCreatorRepository,
    private readonly crossSellUpdaterRepository: CrossSellUpdaterRepository,
    private readonly crossSellDeleterTransactionRepository: CrossSellDeleterTransactionRepository,
    private readonly crossSellAccountCreatorRepository: CrossSellAccountCreatorRepository,
    private readonly crossSellAccountListerRepository: CrossSellAccountListerRepository,
    private readonly crossSellAccountSingleDeleterRepository: CrossSellAccountSingleDeleterRepository
  ) {}

  listCrossSells = async (
    perPage: number,
    currentPage: number,
    query: ListCrossSellRequest
  ): Promise<[ListCrossSellResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.crossSellListerRepository.listCrossSells(
        perPage,
        currentPage,
        query
      ),
      this.crossSellListerRepository.listCrossSellsTotal(query),
    ]);

    return [result, total];
  };

  createCrossSell = async (
    input: CreateCrossSellRequest
  ): Promise<string | null> => {
    return this.crossSellCreatorRepository.createCrossSell(input);
  };

  updateCrossSell = async (
    crossSellId: string,
    input: UpdateCrossSellRequest
  ): Promise<boolean> => {
    return this.crossSellUpdaterRepository.updateCrossSell(crossSellId, input);
  };

  deleteCrossSell = async (
    t: TFunction<'translation', undefined>,
    crossSellId: string
  ): Promise<boolean> => {
    return this.crossSellDeleterTransactionRepository.deleteCrossSell(
      t,
      crossSellId
    );
  };

  createCrossSellAccount = async (
    input: CreateCrossSellAccountRequest
  ): Promise<string | null> => {
    return this.crossSellAccountCreatorRepository.createCrossSellAccount(input);
  };

  listCrossSellAccounts = async (
    crossSellId: string
  ): Promise<ListCrossSellAccountResponse[]> => {
    return this.crossSellAccountListerRepository.listCrossSellAccounts(
      crossSellId
    );
  };

  deleteCrossSellAccount = async (
    crossSellAccountId: string
  ): Promise<boolean> => {
    return this.crossSellAccountSingleDeleterRepository.deleteCrossSellAccountById(
      crossSellAccountId
    );
  };
}
