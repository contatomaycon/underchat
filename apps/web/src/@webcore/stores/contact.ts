import { defineStore } from 'pinia';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListContactFinalResponse,
  ListContactResponse,
} from '@core/schema/contact/listContact/response.schema';
import { IListContact } from '../interfaces/IListContact';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { ViewContactPhoneResponse } from '@core/schema/contact/viewContactPhone/response.schema';
import { ViewContactEmailResponse } from '@core/schema/contact/viewContactEmail/response.schema';
import { ViewContactDocumentResponse } from '@core/schema/contact/viewContactDocument/response.schema';
import { ExportContactResponse } from '@core/schema/contact/exportContact/response.schema';
import { ListContactUsersResponse } from '@core/schema/contact/listUsers/response.schema';
import { ListContactChannelsResponse } from '@core/schema/contact/listContactChannels/response.schema';
import { ListContactLabelTemplatesResponse } from '@core/schema/contact/listLabelTemplates/response.schema';

type FieldValue = string | { value: string } | null;

export const useContactStore = defineStore('contact', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListContactResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
  }),
  actions: {
    showSnackbar(message: string, color: EColor) {
      this.snackbar.message = message;
      this.snackbar.color = color;
      this.snackbar.status = true;
    },
    hideSnackbar() {
      this.snackbar.status = false;
    },

    async listContact(
      input?: IListContact
    ): Promise<ListContactFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListContactRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              search: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListContactFinalResponse>
        >(`/contact`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async getContactDocumentDecrypted(
      contactId: string
    ): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewContactDocumentResponse>
        >(`/contact/${contactId}/document`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.document;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getContactById(
      contactId: string
    ): Promise<ViewContactResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewContactResponse>>(
          `/contact/${contactId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        this.loading = false;

        if (error instanceof Error) {
          this.showSnackbar(error.message, EColor.error);
        }

        return null;
      }
    },

    buildUpdateContactFormData(
      body: UpdateContactRequest,
      photoFile?: File | null
    ): FormData {
      const formData = new FormData();
      if (body.channel_ids !== undefined) {
        const channelIds = extractArrayFieldValue(
          body.channel_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string[] }
            | { value: string[] | null }
            | null
            | undefined
        );
        if (channelIds.length === 0) {
          formData.append('channel_ids', '');
        } else {
          for (let i = 0; i < channelIds.length; i += 1) {
            formData.append(`channel_ids[${i}]`, channelIds[i]);
          }
        }
      }
      if (body.label_template_ids !== undefined) {
        const labelTemplateIds = extractArrayFieldValue(
          body.label_template_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string }
            | { value: string[] }
            | null
            | undefined
        );
        if (labelTemplateIds.length === 0) {
          formData.append('label_template_ids', '');
        } else {
          for (let i = 0; i < labelTemplateIds.length; i += 1) {
            formData.append(`label_template_ids[${i}]`, labelTemplateIds[i]);
          }
        }
      }
      const name = extractFieldValue(body.name as FieldValue);
      if (name) {
        formData.append('name', name);
      }
      const lastName = extractFieldValue(body.last_name as FieldValue);
      if (lastName) {
        formData.append('last_name', lastName);
      }
      const email = extractFieldValue(body.email as FieldValue);
      if (email) {
        formData.append('email', email);
      }
      const phoneDdi = extractFieldValue(body.phone_ddi as FieldValue);
      if (phoneDdi) {
        formData.append('phone_ddi', phoneDdi);
      }
      const phone = extractFieldValue(body.phone as FieldValue);
      if (phone) {
        formData.append('phone', phone);
      }
      const nickname = extractFieldValue(body.nickname as FieldValue);
      if (nickname) {
        formData.append('nickname', nickname);
      }
      const birthday = extractFieldValue(body.birthday as FieldValue);
      if (birthday) {
        formData.append('birthday', birthday);
      }
      const notes = extractFieldValue(body.notes as FieldValue);
      if (notes) {
        formData.append('notes', notes);
      }
      if (body.contact_document_type_id === null) {
        formData.append('contact_document_type_id', '');
      } else if (body.contact_document_type_id !== undefined) {
        const contactDocumentTypeId = extractFieldValue(
          body.contact_document_type_id as FieldValue
        );
        if (contactDocumentTypeId) {
          formData.append('contact_document_type_id', contactDocumentTypeId);
        }
      }
      if (body.document === null) {
        formData.append('document', '');
      } else if (body.document !== undefined) {
        const document = extractFieldValue(body.document as FieldValue);
        if (document) {
          formData.append('document', document);
        }
      }
      const imageUrl = extractFieldValue(body.image_url as FieldValue);
      if (imageUrl) {
        formData.append('image_url', imageUrl);
      } else if (photoFile) {
        formData.append('photo', photoFile);
      }
      const chatId = extractFieldValue(body.chat_id as FieldValue);
      if (chatId) {
        formData.append('chat_id', chatId);
      }
      if (body.user_id !== undefined) {
        if (
          typeof body.user_id === 'object' &&
          body.user_id !== null &&
          'value' in body.user_id &&
          body.user_id.value === null
        ) {
          formData.append('user_id', '');
        } else {
          const userId = extractFieldValue(body.user_id as FieldValue);
          if (userId) {
            formData.append('user_id', userId);
          }
        }
      }
      if (body.ignore !== undefined) {
        const ignoreValue = extractFieldValue(body.ignore as FieldValue);
        if (ignoreValue) {
          formData.append('ignore', ignoreValue);
        }
      }
      return formData;
    },

    async addContact(
      payload: CreateContactRequest,
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();
        const channelIds = extractArrayFieldValue(
          payload.channel_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string[] }
            | null
            | undefined
        );
        for (let i = 0; i < channelIds.length; i += 1) {
          formData.append(`channel_ids[${i}]`, channelIds[i]);
        }
        const labelTemplateIds = extractArrayFieldValue(
          payload.label_template_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string }
            | { value: string[] }
            | null
            | undefined
        );
        for (let i = 0; i < labelTemplateIds.length; i += 1) {
          formData.append(`label_template_ids[${i}]`, labelTemplateIds[i]);
        }
        formData.append(
          'name',
          extractFieldValue(payload.name as string | { value: string })
        );
        const lastName = extractFieldValue(payload.last_name as FieldValue);
        if (lastName) {
          formData.append('last_name', lastName);
        }
        const email = extractFieldValue(payload.email as FieldValue);
        if (email) {
          formData.append('email', email);
        }
        formData.append(
          'phone_ddi',
          extractFieldValue(payload.phone_ddi as string | { value: string })
        );
        formData.append(
          'phone',
          extractFieldValue(payload.phone as string | { value: string })
        );
        const nickname = extractFieldValue(payload.nickname as FieldValue);
        if (nickname) {
          formData.append('nickname', nickname);
        }
        const birthday = extractFieldValue(payload.birthday as FieldValue);
        if (birthday) {
          formData.append('birthday', birthday);
        }
        const notes = extractFieldValue(payload.notes as FieldValue);
        if (notes) {
          formData.append('notes', notes);
        }
        const contactDocumentTypeId = extractFieldValue(
          payload.contact_document_type_id as FieldValue
        );
        if (contactDocumentTypeId) {
          formData.append('contact_document_type_id', contactDocumentTypeId);
        }
        const document = extractFieldValue(payload.document as FieldValue);
        if (document) {
          formData.append('document', document);
        }
        const imageUrl = extractFieldValue(payload.image_url as FieldValue);
        if (imageUrl) {
          formData.append('image_url', imageUrl);
        } else if (photoFile) {
          formData.append('photo', photoFile);
        }
        const chatId = extractFieldValue(payload.chat_id as FieldValue);
        if (chatId) {
          formData.append('chat_id', chatId);
        }
        if (payload.user_id === null) {
          formData.append('user_id', '');
        } else if (payload.user_id !== undefined) {
          const userId = extractFieldValue(payload.user_id as FieldValue);
          if (userId) {
            formData.append('user_id', userId);
          }
        }
        if (payload.ignore !== undefined) {
          const ignoreValue = extractFieldValue(payload.ignore as FieldValue);
          if (ignoreValue) {
            formData.append('ignore', ignoreValue);
          }
        }

        const response = await axios.post<IApiResponse<boolean>>(
          `/contact`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateContact(
      payload: EditContactParamsRequest,
      body: UpdateContactRequest,
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = this.buildUpdateContactFormData(body, photoFile);

        const response = await axios.patch<IApiResponse<boolean>>(
          `/contact/${payload.contact_id}`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteContactPhoto(contactId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/contact/${contactId}/photo`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_photo_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_photo_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_photo_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async removeContactLabelTemplate(
      contactId: string,
      labelTemplateId: string
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/contact/${contactId}/labels/${labelTemplateId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('contact_label_template_remove_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_label_template_removed_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'contact_label_template_remove_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async validateContact(contactId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/contact/${contactId}/validate`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_validation_failed');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_validation_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_validation_failed');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteContact(contactId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/contact/${contactId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_deleted_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_deleted_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_deleted_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async bulkDeleteContacts(contactIds: string[]): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<
          IApiResponse<{ deleted_count: number; failed_count: number }>
        >('/contact/bulk', {
          data: { contact_ids: contactIds },
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contacts_bulk_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        const result = data.data;
        if (result) {
          if (result.failed_count > 0) {
            this.showSnackbar(
              this.i18n.global.t('contacts_bulk_deleted_partial', {
                deleted: result.deleted_count,
                failed: result.failed_count,
              }),
              EColor.warning
            );
          } else {
            this.showSnackbar(
              this.i18n.global.t('contacts_bulk_deleted_success', {
                count: result.deleted_count,
              }),
              EColor.success
            );
          }
        }

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contacts_bulk_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getContactPhoneDecrypted(contactId: string): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewContactPhoneResponse>
        >(`/contact/${contactId}/phone`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.phone;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getContactEmailDecrypted(contactId: string): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewContactEmailResponse>
        >(`/contact/${contactId}/email`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.email;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async exportContacts(): Promise<ExportContactResponse[]> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ExportContactResponse[]>>(
            `/contact/export`
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_export_error');

          this.showSnackbar(mensage, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_export_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return [];
      }
    },

    async listContactChannels(): Promise<ListContactChannelsResponse | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListContactChannelsResponse>>(
            `/contact/channels`
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('contact_channels_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_channels_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async viewContactChannelsByContactId(
      contactId: string
    ): Promise<string[] | null> {
      try {
        const response = await axios.get<IApiResponse<string[]>>(
          `/contact/${contactId}/channels`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('contact_channels_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_channels_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async listContactUsers(): Promise<ListContactUsersResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListContactUsersResponse[]>>(
            `/contact/users`
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_users_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_users_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listLabelTemplates(): Promise<
      ListContactLabelTemplatesResponse[] | null
    > {
      try {
        const response = await axios.get<
          IApiResponse<ListContactLabelTemplatesResponse[]>
        >(`/contact/label-templates`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('label_template_all_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        const errorMessage =
          error instanceof AxiosError
            ? (error?.response?.data?.message ??
              this.i18n.global.t('label_template_all_list_error'))
            : this.i18n.global.t('label_template_all_list_error');

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
  },
});
