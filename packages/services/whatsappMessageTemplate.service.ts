import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { v7 as uuidv7 } from 'uuid';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import {
  CreateWhatsappTemplateRequest,
  DeleteWhatsappTemplateResponse,
  ListWhatsappTemplatesQuery,
  ListWhatsappTemplatesResponse,
  SyncWhatsappTemplatesResponse,
  UpdateWhatsappTemplateRequest,
  UploadWhatsappTemplateMediaResponse,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';
import {
  MetaWhatsappEmbeddedService,
  MetaWhatsappMessageTemplate,
  MetaWhatsappMessageTemplatePayload,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerService } from '@core/services/worker.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  WhatsappMessageTemplateRepository,
  WhatsappTemplateUpsertInput,
} from '@core/repositories/whatsapp/WhatsappMessageTemplate.repository';

interface OfficialTemplateConnection {
  worker_whatsapp_official_connection_id: string;
  worker_id: string;
  waba_id: string;
  phone_number_id: string;
  access_token_encrypted: string;
  api_version: string;
}

interface ResolvedConnection {
  connection: OfficialTemplateConnection;
  accessToken: string;
}

interface TemplateCreateResult {
  metaTemplateId: string | null;
  status: string;
  category: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@injectable()
export class WhatsappMessageTemplateService {
  private readonly MAX_TEMPLATE_MEDIA_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(WhatsappMessageTemplateRepository)
    private readonly whatsappMessageTemplateRepository: WhatsappMessageTemplateRepository
  ) {}

  private async resolveConnection(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    workerId: string;
  }): Promise<ResolvedConnection> {
    const worker = await this.workerService.viewWorker(
      input.accountId,
      input.workerId
    );

    if (!worker) {
      throw new Error(input.t('worker_not_found'));
    }

    if (worker.type?.id !== EWorkerType.whatsapp) {
      throw new Error(input.t('whatsapp_official_disconnect_only_official'));
    }

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        input.workerId
      );

    if (!connection) {
      throw new Error(input.t('whatsapp_official_connection_not_found'));
    }

    return {
      connection,
      accessToken: this.passwordEncryptorService.decrypt(
        connection.access_token_encrypted
      ),
    };
  }

  private buildMetaPayload(
    input: CreateWhatsappTemplateRequest | UpdateWhatsappTemplateRequest,
    options: { includeIdentityFields: boolean }
  ): MetaWhatsappMessageTemplatePayload {
    const payload: MetaWhatsappMessageTemplatePayload = {};

    if (options.includeIdentityFields) {
      payload.name = input.name;
      payload.language = input.language;
    }

    if (input.category !== undefined) {
      payload.category = input.category;
    }

    if (input.sub_category !== undefined) {
      payload.sub_category = input.sub_category;
    }

    if (input.parameter_format !== undefined) {
      payload.parameter_format = input.parameter_format;
    }

    if (input.components !== undefined) {
      payload.components = input.components;
    }

    if (input.message_send_ttl_seconds !== undefined) {
      payload.message_send_ttl_seconds = input.message_send_ttl_seconds;
    }

    return payload;
  }

  private createInputFromMeta(input: {
    accountId: string;
    workerId: string;
    connection: OfficialTemplateConnection;
    template: MetaWhatsappMessageTemplate;
  }): WhatsappTemplateUpsertInput {
    return {
      whatsapp_message_template_id: uuidv7(),
      account_id: input.accountId,
      worker_id: input.workerId,
      worker_whatsapp_official_connection_id:
        input.connection.worker_whatsapp_official_connection_id,
      waba_id: input.connection.waba_id,
      meta_template_id: input.template.id,
      name: input.template.name,
      language: input.template.language,
      category: input.template.category,
      sub_category: input.template.sub_category,
      parameter_format: input.template.parameter_format,
      components: input.template.components,
      status: input.template.status ?? 'PENDING',
      quality_score: input.template.quality_score,
      rejected_reason: input.template.rejected_reason,
      message_send_ttl_seconds: input.template.message_send_ttl_seconds,
      meta_payload: input.template.raw,
      origin: 'meta',
      sync_state: 'synced',
      is_active: true,
      last_synced_at: currentTime(),
      last_error: null,
    };
  }

  private createInputFromLocal(input: {
    accountId: string;
    workerId: string;
    connection: OfficialTemplateConnection;
    request: CreateWhatsappTemplateRequest;
  }): WhatsappTemplateUpsertInput {
    return {
      whatsapp_message_template_id: uuidv7(),
      account_id: input.accountId,
      worker_id: input.workerId,
      worker_whatsapp_official_connection_id:
        input.connection.worker_whatsapp_official_connection_id,
      waba_id: input.connection.waba_id,
      meta_template_id: null,
      name: input.request.name,
      language: input.request.language,
      category: input.request.category,
      sub_category: input.request.sub_category ?? null,
      parameter_format: input.request.parameter_format ?? null,
      components: input.request.components,
      status: 'DRAFT',
      quality_score: null,
      rejected_reason: null,
      message_send_ttl_seconds: input.request.message_send_ttl_seconds ?? null,
      meta_payload: null,
      origin: 'underchat',
      sync_state: 'pending_sync',
      is_active: true,
      last_synced_at: null,
      last_error: null,
    };
  }

  private async createOnMeta(input: {
    connection: OfficialTemplateConnection;
    accessToken: string;
    request: CreateWhatsappTemplateRequest;
  }): Promise<TemplateCreateResult> {
    const result = await this.metaWhatsappEmbeddedService.createMessageTemplate(
      {
        apiVersion: input.connection.api_version,
        accessToken: input.accessToken,
        wabaId: input.connection.waba_id,
        payload: this.buildMetaPayload(input.request, {
          includeIdentityFields: true,
        }),
      }
    );

    return {
      metaTemplateId: result.id ?? null,
      status: result.status ?? 'PENDING',
      category: result.category ?? input.request.category,
    };
  }

  private toCreateRequest(
    template: WhatsappTemplateResponse
  ): CreateWhatsappTemplateRequest {
    return {
      name: template.name,
      language: template.language,
      category: template.category as CreateWhatsappTemplateRequest['category'],
      sub_category: template.sub_category,
      parameter_format:
        template.parameter_format as CreateWhatsappTemplateRequest['parameter_format'],
      components: template.components,
      message_send_ttl_seconds: template.message_send_ttl_seconds,
    };
  }

  async list(
    accountId: string,
    workerId: string,
    query: ListWhatsappTemplatesQuery
  ): Promise<ListWhatsappTemplatesResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;
    const [results, total] = await this.whatsappMessageTemplateRepository.list({
      accountId,
      workerId,
      query,
    });
    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return { pagings, results };
  }

  async view(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    templateId: string
  ): Promise<WhatsappTemplateResponse> {
    await this.resolveConnection({ t, accountId, workerId });
    const template = await this.whatsappMessageTemplateRepository.view({
      accountId,
      workerId,
      templateId,
    });

    if (!template) {
      throw new Error(t('whatsapp_template_not_found'));
    }

    return template;
  }

  async sync(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<SyncWhatsappTemplatesResponse> {
    const { connection, accessToken } = await this.resolveConnection({
      t,
      accountId,
      workerId,
    });
    const response: SyncWhatsappTemplatesResponse = {
      fetched_from_meta: 0,
      upserted_from_meta: 0,
      created_on_meta: 0,
      recreated_on_meta: 0,
      marked_inactive: 0,
      errors: [],
    };

    const remoteTemplates =
      await this.metaWhatsappEmbeddedService.listMessageTemplates({
        apiVersion: connection.api_version,
        accessToken,
        wabaId: connection.waba_id,
      });
    response.fetched_from_meta = remoteTemplates.length;

    const remoteKeys = new Set<string>();

    for (const template of remoteTemplates) {
      if (template.id) {
        remoteKeys.add(`id:${template.id}`);
      }
      remoteKeys.add(`name:${template.name}:${template.language}`);
      await this.whatsappMessageTemplateRepository.upsertFromMeta(
        this.createInputFromMeta({
          accountId,
          workerId,
          connection,
          template,
        })
      );
      response.upserted_from_meta += 1;
    }

    const localTemplates =
      await this.whatsappMessageTemplateRepository.listAllByWorker({
        accountId,
        workerId,
      });

    for (const template of localTemplates) {
      if (!template.is_active) {
        continue;
      }

      const remoteExists = template.meta_template_id
        ? remoteKeys.has(`id:${template.meta_template_id}`)
        : remoteKeys.has(`name:${template.name}:${template.language}`);

      if (remoteExists) {
        continue;
      }

      try {
        const request = this.toCreateRequest(template);
        const result = await this.createOnMeta({
          connection,
          accessToken,
          request,
        });
        await this.whatsappMessageTemplateRepository.update({
          accountId,
          workerId,
          templateId: template.whatsapp_message_template_id,
          data: {
            meta_template_id: result.metaTemplateId,
            status: result.status,
            category: result.category,
            sync_state: 'synced',
            last_synced_at: currentTime(),
            last_error: null,
          },
        });

        if (template.meta_template_id) {
          response.recreated_on_meta += 1;
        } else {
          response.created_on_meta += 1;
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('whatsapp_template_sync_error');
        response.errors.push(`${template.name}: ${message}`);
        await this.whatsappMessageTemplateRepository.markError({
          accountId,
          workerId,
          templateId: template.whatsapp_message_template_id,
          error: message,
        });
      }
    }

    return response;
  }

  async create(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    request: CreateWhatsappTemplateRequest
  ): Promise<WhatsappTemplateResponse> {
    const { connection, accessToken } = await this.resolveConnection({
      t,
      accountId,
      workerId,
    });
    const local = await this.whatsappMessageTemplateRepository.create(
      this.createInputFromLocal({
        accountId,
        workerId,
        connection,
        request,
      })
    );

    try {
      const result = await this.createOnMeta({
        connection,
        accessToken,
        request,
      });
      const updated = await this.whatsappMessageTemplateRepository.update({
        accountId,
        workerId,
        templateId: local.whatsapp_message_template_id,
        data: {
          meta_template_id: result.metaTemplateId,
          status: result.status,
          category: result.category,
          sync_state: 'synced',
          last_synced_at: currentTime(),
          last_error: null,
        },
      });

      if (!updated) {
        throw new Error(t('whatsapp_template_update_error'));
      }

      return updated;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('whatsapp_template_create_error');
      await this.whatsappMessageTemplateRepository.markError({
        accountId,
        workerId,
        templateId: local.whatsapp_message_template_id,
        error: message,
      });
      throw new Error(message);
    }
  }

  async update(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    templateId: string,
    request: UpdateWhatsappTemplateRequest
  ): Promise<WhatsappTemplateResponse> {
    const { connection, accessToken } = await this.resolveConnection({
      t,
      accountId,
      workerId,
    });
    const current = await this.view(t, accountId, workerId, templateId);

    if (current.meta_template_id) {
      try {
        const result =
          await this.metaWhatsappEmbeddedService.updateMessageTemplate({
            apiVersion: connection.api_version,
            accessToken,
            templateId: current.meta_template_id,
            payload: this.buildMetaPayload(request, {
              includeIdentityFields: false,
            }),
          });
        const updated = await this.whatsappMessageTemplateRepository.update({
          accountId,
          workerId,
          templateId,
          data: {
            ...request,
            status: result.status ?? current.status,
            category: result.category ?? request.category ?? current.category,
            sync_state: 'synced',
            last_synced_at: currentTime(),
            last_error: null,
          },
        });

        if (!updated) {
          throw new Error(t('whatsapp_template_update_error'));
        }

        return updated;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('whatsapp_template_update_error');
        await this.whatsappMessageTemplateRepository.markError({
          accountId,
          workerId,
          templateId,
          error: message,
        });
        throw new Error(message);
      }
    }

    const mergedRequest: CreateWhatsappTemplateRequest = {
      name: request.name ?? current.name,
      language: request.language ?? current.language,
      category:
        (request.category as CreateWhatsappTemplateRequest['category']) ??
        (current.category as CreateWhatsappTemplateRequest['category']),
      sub_category: request.sub_category ?? current.sub_category,
      parameter_format:
        request.parameter_format ??
        (current.parameter_format as CreateWhatsappTemplateRequest['parameter_format']),
      components: request.components ?? current.components,
      message_send_ttl_seconds:
        request.message_send_ttl_seconds ?? current.message_send_ttl_seconds,
    };

    const result = await this.createOnMeta({
      connection,
      accessToken,
      request: mergedRequest,
    });
    const updated = await this.whatsappMessageTemplateRepository.update({
      accountId,
      workerId,
      templateId,
      data: {
        ...mergedRequest,
        meta_template_id: result.metaTemplateId,
        status: result.status,
        category: result.category,
        sync_state: 'synced',
        last_synced_at: currentTime(),
        last_error: null,
      },
    });

    if (!updated) {
      throw new Error(t('whatsapp_template_update_error'));
    }

    return updated;
  }

  async delete(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    templateId: string
  ): Promise<DeleteWhatsappTemplateResponse> {
    const { connection, accessToken } = await this.resolveConnection({
      t,
      accountId,
      workerId,
    });
    const current = await this.view(t, accountId, workerId, templateId);

    if (current.meta_template_id) {
      try {
        await this.metaWhatsappEmbeddedService.deleteMessageTemplate({
          apiVersion: connection.api_version,
          accessToken,
          wabaId: connection.waba_id,
          name: current.name,
          templateId: current.meta_template_id,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('whatsapp_template_delete_error');
        await this.whatsappMessageTemplateRepository.markError({
          accountId,
          workerId,
          templateId,
          error: message,
        });
        throw new Error(message);
      }
    }

    await this.whatsappMessageTemplateRepository.update({
      accountId,
      workerId,
      templateId,
      data: {
        status: 'DELETED',
        sync_state: 'synced',
        is_active: false,
        last_synced_at: currentTime(),
        last_error: null,
      },
    });

    return {
      whatsapp_message_template_id: templateId,
      meta_deleted: Boolean(current.meta_template_id),
      deactivated: true,
      last_error: null,
    };
  }

  async deactivate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    templateId: string
  ): Promise<DeleteWhatsappTemplateResponse> {
    await this.resolveConnection({ t, accountId, workerId });
    await this.view(t, accountId, workerId, templateId);
    const updated = await this.whatsappMessageTemplateRepository.update({
      accountId,
      workerId,
      templateId,
      data: {
        sync_state: 'inactive',
        is_active: false,
        last_error: null,
      },
    });

    if (!updated) {
      throw new Error(t('whatsapp_template_update_error'));
    }

    return {
      whatsapp_message_template_id: templateId,
      meta_deleted: false,
      deactivated: true,
      last_error: null,
    };
  }

  private async fileToBuffer(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<Buffer> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_TEMPLATE_MEDIA_SIZE_BYTES) {
      throw new Error(t('profile_info_file_size_exceeded', { max: '16 MB' }));
    }

    return buffer;
  }

  async uploadMedia(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    file: UploadFileRequest
  ): Promise<UploadWhatsappTemplateMediaResponse> {
    if (!isRecord(file) || typeof file.toBuffer !== 'function') {
      throw new Error(t('whatsapp_template_media_required'));
    }

    const { connection, accessToken } = await this.resolveConnection({
      t,
      accountId,
      workerId,
    });
    const config = await this.whatsappEmbeddedService.viewInternalConfig(t);
    const fileBuffer = await this.fileToBuffer(file, t);
    const mimetype = file.mimetype ?? 'application/octet-stream';
    const handle = await this.metaWhatsappEmbeddedService.uploadFile({
      apiVersion: connection.api_version,
      accessToken,
      appId: config.app_id,
      filename: file.filename,
      fileType: mimetype,
      fileBuffer,
    });

    return {
      handle,
      filename: file.filename,
      mimetype,
    };
  }
}
