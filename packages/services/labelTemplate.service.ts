import { injectable } from 'tsyringe';
import { LabelTemplateListerRepository } from '@core/repositories/labelTemplate/LabelTemplateLister.repository';
import { ListLabelTemplateRequest } from '@core/schema/labelTemplate/listLabelTemplate/request.schema';
import { ListLabelTemplateResponse } from '@core/schema/labelTemplate/listLabelTemplate/response.schema';
import { LabelStatusViewerExistsRepository } from '@core/repositories/labelTemplate/LabelStatusViewerExists.repository';
import { LabelTemplateViewerExistsRepository } from '@core/repositories/labelTemplate/LabelTemplateViewerExists.repository';
import { LabelTemplateCreatorRepository } from '@core/repositories/labelTemplate/LabelTemplateCreator.repository';
import { CreateLabelTemplateRequest } from '@core/schema/labelTemplate/createLabelTemplate/request.schema';
import { LabelTemplateViewerRepository } from '@core/repositories/labelTemplate/LabelTemplateViewer.repository';
import { ViewLabelTemplateResponse } from '@core/schema/labelTemplate/viewLabelTemplate/response.schema';
import { LabelTemplateDeleterRepository } from '@core/repositories/labelTemplate/LabelTemplateDeleter.repository';
import { LabelTemplateUpdaterRepository } from '@core/repositories/labelTemplate/LabelTemplateUpdater.repository';
import { UpdateLabelTemplateRequest } from '@core/schema/labelTemplate/editLabelTemplate/request.schema';
import { LabelTemplateAllListerRepository } from '@core/repositories/labelTemplate/LabelTemplateAllLister.repository';
import { ListLabelTemplateAllResponse } from '@core/schema/labelTemplate/listLabelTemplateAll/response.schema';

@injectable()
export class LabelTemplateService {
  constructor(
    private readonly labelTemplateListerRepository: LabelTemplateListerRepository,
    private readonly labelStatusViewerExistsRepository: LabelStatusViewerExistsRepository,
    private readonly labelTemplateViewerExistsRepository: LabelTemplateViewerExistsRepository,
    private readonly labelTemplateCreatorRepository: LabelTemplateCreatorRepository,
    private readonly labelTemplateViewerRepository: LabelTemplateViewerRepository,
    private readonly labelTemplateDeleterRepository: LabelTemplateDeleterRepository,
    private readonly labelTemplateUpdaterRepository: LabelTemplateUpdaterRepository,
    private readonly labelTemplateAllListerRepository: LabelTemplateAllListerRepository
  ) {}

  listLabelTemplates = async (
    perPage: number,
    currentPage: number,
    query: ListLabelTemplateRequest,
    accountId: string
  ): Promise<[ListLabelTemplateResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.labelTemplateListerRepository.listLabelTemplates(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.labelTemplateListerRepository.listLabelTemplateTotal(
        query,
        accountId
      ),
    ]);

    return [result, total];
  };

  existsLabelStatusById = async (labelStatusId: string): Promise<boolean> => {
    return this.labelStatusViewerExistsRepository.existsLabelStatusById(
      labelStatusId
    );
  };

  existsLabelTemplateById = async (
    labelTemplateId: string
  ): Promise<boolean> => {
    return this.labelTemplateViewerExistsRepository.existsLabelTemplateById(
      labelTemplateId
    );
  };

  existsLabelTemplatesByIds = async (
    labelTemplateIds: string[]
  ): Promise<Set<string>> => {
    return this.labelTemplateViewerExistsRepository.existsLabelTemplatesByIds(
      labelTemplateIds
    );
  };

  createLabelTemplate = async (
    input: CreateLabelTemplateRequest,
    accountId: string
  ): Promise<string | null> => {
    return this.labelTemplateCreatorRepository.createLabelTemplate(
      input,
      accountId
    );
  };

  viewLabelTemplateById = async (
    labelTemplateId: string
  ): Promise<ViewLabelTemplateResponse | null> => {
    return this.labelTemplateViewerRepository.viewLabelTemplateById(
      labelTemplateId
    );
  };

  deleteLabelTemplateById = async (
    labelTemplateId: string
  ): Promise<boolean> => {
    return this.labelTemplateDeleterRepository.deleteLabelTemplateById(
      labelTemplateId
    );
  };

  updateLabelTemplateById = async (
    labelTemplateId: string,
    input: Partial<UpdateLabelTemplateRequest>
  ): Promise<boolean> => {
    return this.labelTemplateUpdaterRepository.updateLabelTemplateById(
      labelTemplateId,
      input
    );
  };

  listLabelTemplateAll = async (
    accountId: string
  ): Promise<ListLabelTemplateAllResponse[]> => {
    return this.labelTemplateAllListerRepository.listLabelTemplateAll(
      accountId
    );
  };
}
