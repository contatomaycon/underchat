import { injectable } from 'tsyringe';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { ListExpenditureResponse } from '@core/schema/expenditure/listExpenditure/response.schema';
import { ExpenditureListerRepository } from '@core/repositories/expenditure/ExpenditureLister.repository';
import { ExpenditureCreatorRepository } from '@core/repositories/expenditure/ExpenditureCreator.repository';
import { ExpenditureUpdaterRepository } from '@core/repositories/expenditure/ExpenditureUpdater.repository';
import { ExpenditureDeleterRepository } from '@core/repositories/expenditure/ExpenditureDeleter.repository';
import { ExpenditureViewerRepository } from '@core/repositories/expenditure/ExpenditureViewer.repository';
import { CreateExpenditureRequest } from '@core/schema/expenditure/createExpenditure/request.schema';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/updateExpenditure/request.schema';

@injectable()
export class ExpenditureService {
  constructor(
    private readonly expenditureListerRepository: ExpenditureListerRepository,
    private readonly expenditureCreatorRepository: ExpenditureCreatorRepository,
    private readonly expenditureUpdaterRepository: ExpenditureUpdaterRepository,
    private readonly expenditureDeleterRepository: ExpenditureDeleterRepository,
    private readonly expenditureViewerRepository: ExpenditureViewerRepository
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

  updateExpenditure = async (
    expenditureId: string,
    input: UpdateExpenditureRequest
  ): Promise<boolean> => {
    return this.expenditureUpdaterRepository.updateExpenditure(
      expenditureId,
      input
    );
  };

  deleteExpenditure = async (expenditureId: string): Promise<boolean> => {
    return this.expenditureDeleterRepository.deleteExpenditureById(
      expenditureId
    );
  };

  viewExpenditureById = async (
    expenditureId: string
  ): Promise<ListExpenditureResponse | null> => {
    return this.expenditureViewerRepository.viewExpenditureById(expenditureId);
  };
}
