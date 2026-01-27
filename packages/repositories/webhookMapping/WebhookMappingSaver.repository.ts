import { injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { webhookMappingMappings } from '@core/mappings/webhookMapping.mappings';

@injectable()
export class WebhookMappingSaverRepository {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  saveWebhookMapping = async (
    accountId: string,
    workerId: string,
    mapping: Record<string, string | string[]>
  ): Promise<boolean> => {
    const indexCreated = await this.ensureIndexExists();

    if (!indexCreated) {
      return false;
    }

    const document = await this.prepareDocument(accountId, workerId, mapping);

    const documentId = `${accountId}_${workerId}`;
    const updateResult = await this.saveDocument(documentId, document);

    return (
      updateResult === 'updated' ||
      updateResult === 'created' ||
      updateResult === 'noop'
    );
  };

  private readonly ensureIndexExists = async (): Promise<boolean> => {
    const mappings = webhookMappingMappings();

    const result = await this.elasticDatabaseService.indices(
      EElasticIndex.webhook_mapping,
      mappings
    );

    return result !== null && result !== undefined;
  };

  private readonly prepareDocument = async (
    accountId: string,
    workerId: string,
    mapping: Record<string, string | string[]>
  ): Promise<{
    account_id: string;
    worker_id: string;
    mapping: Record<string, string | string[]>;
    created_at?: string;
    updated_at: string;
  }> => {
    const documentId = `${accountId}_${workerId}`;
    const existing = await this.getExistingDocument(documentId);

    const mergedMapping = this.mergeMappings(existing, mapping);
    const finalMapping = this.cleanTransferFields(mergedMapping);

    const now = new Date().toISOString();
    const document = this.buildDocument(
      accountId,
      workerId,
      finalMapping,
      now,
      existing
    );

    return document;
  };

  private readonly getExistingDocument = async (
    documentId: string
  ): Promise<unknown> => {
    return this.elasticDatabaseService.view(
      EElasticIndex.webhook_mapping,
      documentId
    );
  };

  private readonly mergeMappings = (
    existing: unknown,
    newMapping: Record<string, string | string[]>
  ): Record<string, string | string[]> => {
    const existingMapping = this.extractExistingMapping(existing);
    if (!existingMapping) {
      return { ...newMapping };
    }

    const cleanedExistingMapping = this.removeOppositeTransferFields(
      existingMapping,
      newMapping
    );
    const removedOptionalFields = this.removeOptionalFieldsNotInNew(
      cleanedExistingMapping,
      newMapping
    );

    return { ...removedOptionalFields, ...newMapping };
  };

  private readonly removeOptionalFieldsNotInNew = (
    existingMapping: Record<string, string | string[]>,
    newMapping: Record<string, string | string[]>
  ): Record<string, string | string[]> => {
    const cleaned = { ...existingMapping };
    const newMappingKeys = new Set(Object.keys(newMapping));

    for (const key in cleaned) {
      if (key === 'message_type') {
        continue;
      }

      if (!newMappingKeys.has(key)) {
        delete cleaned[key];
      }
    }

    return cleaned;
  };

  private readonly removeOppositeTransferFields = (
    existingMapping: Record<string, string | string[]>,
    newMapping: Record<string, string | string[]>
  ): Record<string, string | string[]> => {
    const cleaned = { ...existingMapping };

    const hasTransferUserIdInNew =
      typeof newMapping.transfer_user_id === 'string' &&
      newMapping.transfer_user_id.length > 0;
    const hasTransferSectorIdInNew =
      typeof newMapping.transfer_sector_id === 'string' &&
      newMapping.transfer_sector_id.length > 0;
    const hasTransferSectorUserIdInNew =
      typeof newMapping.transfer_sector_user_id === 'string' &&
      newMapping.transfer_sector_user_id.length > 0;

    if (hasTransferUserIdInNew) {
      delete cleaned.transfer_sector_id;
      delete cleaned.transfer_sector_user_id;
      return cleaned;
    }

    if (hasTransferSectorIdInNew) {
      delete cleaned.transfer_user_id;
      if (!hasTransferSectorUserIdInNew) {
        delete cleaned.transfer_sector_user_id;
      }
      return cleaned;
    }

    if (!hasTransferUserIdInNew && !hasTransferSectorIdInNew) {
      const messageType = newMapping.message_type;
      if (typeof messageType === 'string' && messageType === 'message') {
        delete cleaned.transfer_user_id;
        delete cleaned.transfer_sector_id;
        delete cleaned.transfer_sector_user_id;
      }
    }

    return cleaned;
  };

  private readonly extractExistingMapping = (
    existing: unknown
  ): Record<string, string | string[]> | null => {
    if (!existing) {
      return null;
    }

    if (typeof existing !== 'object') {
      return null;
    }

    if (!('mapping' in existing)) {
      return null;
    }

    if (!existing.mapping) {
      return null;
    }

    if (typeof existing.mapping !== 'object') {
      return null;
    }

    return existing.mapping as Record<string, string | string[]>;
  };

  private readonly buildDocument = (
    accountId: string,
    workerId: string,
    mapping: Record<string, string | string[]>,
    now: string,
    existing: unknown
  ): {
    account_id: string;
    worker_id: string;
    mapping: Record<string, string | string[]>;
    created_at?: string;
    updated_at: string;
  } => {
    const document: {
      account_id: string;
      worker_id: string;
      mapping: Record<string, string | string[]>;
      created_at?: string;
      updated_at: string;
    } = {
      account_id: accountId,
      worker_id: workerId,
      mapping,
      updated_at: now,
    };

    if (!existing) {
      document.created_at = now;
    }

    return document;
  };

  private readonly cleanTransferFields = (
    mapping: Record<string, string | string[]>
  ): Record<string, string | string[]> => {
    const cleanedMapping = { ...mapping };

    const hasTransferUserId = this.hasTransferUserId(cleanedMapping);
    if (hasTransferUserId) {
      this.removeSectorTransferFields(cleanedMapping);
      return cleanedMapping;
    }

    const hasTransferSectorId = this.hasTransferSectorId(cleanedMapping);
    if (hasTransferSectorId) {
      this.removeUserTransferField(cleanedMapping);
      const hasTransferSectorUserId =
        this.hasTransferSectorUserId(cleanedMapping);
      if (!hasTransferSectorUserId) {
        delete cleanedMapping.transfer_sector_user_id;
      }
      return cleanedMapping;
    }

    const messageType = cleanedMapping.message_type;
    if (
      typeof messageType === 'string' &&
      messageType === 'message' &&
      !hasTransferUserId &&
      !hasTransferSectorId
    ) {
      this.removeAllTransferFields(cleanedMapping);
    }

    return cleanedMapping;
  };

  private readonly hasTransferUserId = (
    mapping: Record<string, string | string[]>
  ): boolean => {
    return (
      typeof mapping.transfer_user_id === 'string' &&
      mapping.transfer_user_id.length > 0
    );
  };

  private readonly hasTransferSectorId = (
    mapping: Record<string, string | string[]>
  ): boolean => {
    return (
      typeof mapping.transfer_sector_id === 'string' &&
      mapping.transfer_sector_id.length > 0
    );
  };

  private readonly hasTransferSectorUserId = (
    mapping: Record<string, string | string[]>
  ): boolean => {
    return (
      typeof mapping.transfer_sector_user_id === 'string' &&
      mapping.transfer_sector_user_id.length > 0
    );
  };

  private readonly removeSectorTransferFields = (
    mapping: Record<string, string | string[]>
  ): void => {
    delete mapping.transfer_sector_id;
    delete mapping.transfer_sector_user_id;
  };

  private readonly removeUserTransferField = (
    mapping: Record<string, string | string[]>
  ): void => {
    delete mapping.transfer_user_id;
  };

  private readonly removeAllTransferFields = (
    mapping: Record<string, string | string[]>
  ): void => {
    delete mapping.transfer_user_id;
    delete mapping.transfer_sector_id;
    delete mapping.transfer_sector_user_id;
  };

  private readonly saveDocument = async (
    documentId: string,
    document: {
      account_id: string;
      worker_id: string;
      mapping: Record<string, string | string[]>;
      created_at?: string;
      updated_at: string;
    }
  ): Promise<'updated' | 'created' | 'noop' | 'conflict' | 'not_found'> => {
    const scriptSource = 'ctx._source = params.doc;';
    const scriptParams = { doc: document };

    const updateResult = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.webhook_mapping,
      documentId,
      {
        source: scriptSource,
        params: scriptParams,
        upsert: document,
      },
      {
        upsert: true,
        maxRetries: 5,
      }
    );

    return updateResult;
  };
}
