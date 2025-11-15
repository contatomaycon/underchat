import { injectable } from 'tsyringe';
import { ContactGroupListerRepository } from '@core/repositories/contactGroup/ContactGroupLister.repository';
import { ListContactGroupRequest } from '@core/schema/contactGroup/listContactGroup/request.schema';
import { ListContactGroupResponse } from '@core/schema/contactGroup/listContactGroup/response.schema';
import { ContactGroupAllListerRepository } from '@core/repositories/contactGroup/ContactGroupAllLister.repository';
import { ListContactGroupAllResponse } from '@core/schema/contactGroup/listContactGroupAll/response.schema';
import { TFunction } from 'i18next';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';
import { ContactGroupCreatorTransactionRepository } from '@core/repositories/contactGroup/ContactGroupCreatorTransaction.repository';
import { ContactGroupViewerExistsRepository } from '@core/repositories/contactGroup/ContactGroupViewerExists.repository';
import { ContactGroupViewerRepository } from '@core/repositories/contactGroup/ContactGroupViewer.repository';
import { ViewContactGroupResponse } from '@core/schema/contactGroup/viewContactGroup/response.schema';
import { UpdateContactGroupRequest } from '@core/schema/contactGroup/editContactGroup/request.schema';
import { ContactGroupDeleterTransactionRepository } from '@core/repositories/contactGroup/ContactGroupDeleterTransaction.repository';
import { ContactGroupUpdaterTransactionRepository } from '@core/repositories/contactGroup/ContactGroupUpdaterTransaction.repository';

@injectable()
export class ContactGroupService {
  constructor(
    private readonly contactGroupListerRepository: ContactGroupListerRepository,
    private readonly contactGroupAllListerRepository: ContactGroupAllListerRepository,
    private readonly contactGroupCreatorTransactionRepository: ContactGroupCreatorTransactionRepository,
    private readonly contactGroupViewerExistsRepository: ContactGroupViewerExistsRepository,
    private readonly contactGroupViewerRepository: ContactGroupViewerRepository,
    private readonly contactGroupDeleterTransactionRepository: ContactGroupDeleterTransactionRepository,
    private readonly contactGroupUpdaterTransactionRepository: ContactGroupUpdaterTransactionRepository
  ) {}

  listContactGroups = async (
    perPage: number,
    currentPage: number,
    query: ListContactGroupRequest,
    isAdministrator: boolean,
    accountId: string
  ): Promise<[ListContactGroupResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.contactGroupListerRepository.listContactGroups(
        perPage,
        currentPage,
        query,
        isAdministrator,
        accountId
      ),
      this.contactGroupListerRepository.listContactGroupTotal(
        query,
        isAdministrator,
        accountId
      ),
    ]);

    return [result, total];
  };

  listContactGroupAll = async (
    accountId: string
  ): Promise<ListContactGroupAllResponse[] | null> => {
    return this.contactGroupAllListerRepository.listContactGroupAll(accountId);
  };

  createContactGroup = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateContactGroupRequest
  ): Promise<boolean> => {
    return this.contactGroupCreatorTransactionRepository.createContactGroup(
      t,
      accountId,
      input
    );
  };

  existsContactGroupById = async (contactGroupId: string): Promise<boolean> => {
    return this.contactGroupViewerExistsRepository.existsContactGroupById(
      contactGroupId
    );
  };

  viewContactGroupById = async (
    contactGroupId: string
  ): Promise<ViewContactGroupResponse | null> => {
    return this.contactGroupViewerRepository.viewContactGroupById(
      contactGroupId
    );
  };

  deleteContactGroup = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string
  ): Promise<boolean> => {
    return this.contactGroupDeleterTransactionRepository.deleteContactGroup(
      t,
      contactGroupId
    );
  };

  updateContactGroupById = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    input: UpdateContactGroupRequest
  ): Promise<boolean> => {
    return this.contactGroupUpdaterTransactionRepository.updateContactGroup(
      t,
      contactGroupId,
      input
    );
  };
}
