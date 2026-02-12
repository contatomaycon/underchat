import { ApiKeyCreatorRepository } from '@core/repositories/apiKey/ApiKeyCreator.repository';
import { ApiKeyDeleterRepository } from '@core/repositories/apiKey/ApiKeyDeleter.repository';
import { injectable, inject } from 'tsyringe';

@injectable()
export class ApiKeyService {
  constructor(
    @inject(ApiKeyCreatorRepository)
    private readonly apiKeyCreatorRepository: ApiKeyCreatorRepository,
    @inject(ApiKeyDeleterRepository)
    private readonly apiKeyDeleterRepository: ApiKeyDeleterRepository
  ) {}

  createApiKey = async (
    accountId: string,
    name: string
  ): Promise<string | null> => {
    return this.apiKeyCreatorRepository.createApiKey(accountId, name);
  };

  deleteApiKey = async (accountId: string): Promise<boolean> => {
    return this.apiKeyDeleterRepository.deleteApiKeyById(accountId);
  };
}
