import { injectable, inject } from 'tsyringe';
import { ExpenditureListerRepository } from '@core/repositories/expenditure/ExpenditureLister.repository';
import { ListExpenditureResponse } from '@core/schema/expenditure/listExpenditure/response.schema';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { ExpenditureCreatorRepository } from '@core/repositories/expenditure/ExpenditureCreator.repository';
import { CreateExpenditureRequest } from '@core/schema/expenditure/createExpenditure/request.schema';
import { ExpenditureViewerRepository } from '@core/repositories/expenditure/ExpenditureViewer.repository';
import { ViewExpenditureResponse } from '@core/schema/expenditure/viewExpenditure/response.schema';
import { ExpenditureDeleterRepository } from '@core/repositories/expenditure/ExpenditureDeleter.repository';
import { ExpenditureUpdaterRepository } from '@core/repositories/expenditure/ExpenditureUpdater.repository';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/editExpenditure/request.schema';
import { ExpenditureViewerExistsRepository } from '@core/repositories/expenditure/ExpenditureViewerExists.repository';

@injectable()
export class ExpenditureService {
  constructor(
    @inject(ExpenditureListerRepository)
    private readonly expenditureListerRepository: ExpenditureListerRepository,
    @inject(ExpenditureCreatorRepository)
    private readonly expenditureCreatorRepository: ExpenditureCreatorRepository,
    @inject(ExpenditureViewerRepository)
    private readonly expenditureViewerRepository: ExpenditureViewerRepository,
    @inject(ExpenditureDeleterRepository)
    private readonly expenditureDeleterRepository: ExpenditureDeleterRepository,
    @inject(ExpenditureUpdaterRepository)
    private readonly expenditureUpdaterRepository: ExpenditureUpdaterRepository,
    @inject(ExpenditureViewerExistsRepository)
    private readonly expenditureViewerExistsRepository: ExpenditureViewerExistsRepository
  ) {}

  listExpenditures = async (
    perPage: number,
    currentPage: number,
    query: ListExpenditureRequest
  ): Promise<[ListExpenditureResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.expenditureListerRepository.listExpenditures(
        perPage,
        currentPage,
        query
      ),
      this.expenditureListerRepository.listExpendituresTotal(query),
    ]);

    return [result, total];
  };

  createExpenditure = async (
    input: CreateExpenditureRequest
  ): Promise<string | null> => {
    return this.expenditureCreatorRepository.createExpenditure(input);
  };

  viewExpenditure = async (
    expenditureId: string
  ): Promise<ViewExpenditureResponse | null> => {
    return this.expenditureViewerRepository.viewExpenditure(expenditureId);
  };

  deleteExpenditureById = async (expenditureId: string): Promise<boolean> => {
    return this.expenditureDeleterRepository.deleteExpenditureById(
      expenditureId
    );
  };

  updateExpenditureById = async (
    input: UpdateExpenditureRequest,
    expenditureId: string
  ): Promise<boolean> => {
    return this.expenditureUpdaterRepository.updateExpenditureById(
      input,
      expenditureId
    );
  };

  existsExpenditureById = async (expenditureId: string): Promise<boolean> => {
    return this.expenditureViewerExistsRepository.existsExpenditureById(
      expenditureId
    );
  };
}
