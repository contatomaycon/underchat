import { defineStore } from 'pinia';
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

    extractFieldValue(field: FieldValue | undefined): string {
      if (field === null || field === undefined) {
        return '';
      }

      if (typeof field === 'object' && 'value' in field) {
        return field.value ?? '';
      }

      if (typeof field === 'string') {
        return field;
      }

      return '';
    },

    buildUpdateContactFormData(
      body: UpdateContactRequest,
      photoFile?: File | null
    ): FormData {
      const formData = new FormData();
      if (body.label_template_id === null) {
        formData.append('label_template_id', '');
      } else if (body.label_template_id !== undefined) {
        const labelTemplateId = this.extractFieldValue(
          body.label_template_id as FieldValue
        );

        if (labelTemplateId) {
          formData.append('label_template_id', labelTemplateId);
        }
      }
      const name = this.extractFieldValue(body.name as FieldValue);
      if (name) {
        formData.append('name', name);
      }
      const lastName = this.extractFieldValue(body.last_name as FieldValue);
      if (lastName) {
        formData.append('last_name', lastName);
      }
      const email = this.extractFieldValue(body.email as FieldValue);
      if (email) {
        formData.append('email', email);
      }
      const phoneDdi = this.extractFieldValue(body.phone_ddi as FieldValue);
      if (phoneDdi) {
        formData.append('phone_ddi', phoneDdi);
      }
      const phone = this.extractFieldValue(body.phone as FieldValue);
      if (phone) {
        formData.append('phone', phone);
      }
      const nickname = this.extractFieldValue(body.nickname as FieldValue);
      if (nickname) {
        formData.append('nickname', nickname);
      }
      const birthday = this.extractFieldValue(body.birthday as FieldValue);
      if (birthday) {
        formData.append('birthday', birthday);
      }
      const notes = this.extractFieldValue(body.notes as FieldValue);
      if (notes) {
        formData.append('notes', notes);
      }
      if (body.contact_document_type_id === null) {
        formData.append('contact_document_type_id', '');
      } else if (body.contact_document_type_id !== undefined) {
        const contactDocumentTypeId = this.extractFieldValue(
          body.contact_document_type_id as FieldValue
        );
        if (contactDocumentTypeId) {
          formData.append('contact_document_type_id', contactDocumentTypeId);
        }
      }
      if (body.document === null) {
        formData.append('document', '');
      } else if (body.document !== undefined) {
        const document = this.extractFieldValue(body.document as FieldValue);
        if (document) {
          formData.append('document', document);
        }
      }
      const imageUrl = this.extractFieldValue(body.image_url as FieldValue);
      if (imageUrl) {
        formData.append('image_url', imageUrl);
      } else if (photoFile) {
        formData.append('photo', photoFile);
      }
      const chatId = this.extractFieldValue(body.chat_id as FieldValue);
      if (chatId) {
        formData.append('chat_id', chatId);
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
        const labelTemplateId = this.extractFieldValue(
          payload.label_template_id as FieldValue
        );
        if (labelTemplateId) {
          formData.append('label_template_id', labelTemplateId);
        }
        formData.append(
          'name',
          this.extractFieldValue(payload.name as string | { value: string })
        );
        const lastName = this.extractFieldValue(
          payload.last_name as FieldValue
        );
        if (lastName) {
          formData.append('last_name', lastName);
        }
        const email = this.extractFieldValue(payload.email as FieldValue);
        if (email) {
          formData.append('email', email);
        }
        formData.append(
          'phone_ddi',
          this.extractFieldValue(
            payload.phone_ddi as string | { value: string }
          )
        );
        formData.append(
          'phone',
          this.extractFieldValue(payload.phone as string | { value: string })
        );
        const nickname = this.extractFieldValue(payload.nickname as FieldValue);
        if (nickname) {
          formData.append('nickname', nickname);
        }
        const birthday = this.extractFieldValue(payload.birthday as FieldValue);
        if (birthday) {
          formData.append('birthday', birthday);
        }
        const notes = this.extractFieldValue(payload.notes as FieldValue);
        if (notes) {
          formData.append('notes', notes);
        }
        const contactDocumentTypeId = this.extractFieldValue(
          payload.contact_document_type_id as FieldValue
        );
        if (contactDocumentTypeId) {
          formData.append('contact_document_type_id', contactDocumentTypeId);
        }
        const document = this.extractFieldValue(payload.document as FieldValue);
        if (document) {
          formData.append('document', document);
        }
        const imageUrl = this.extractFieldValue(
          payload.image_url as FieldValue
        );
        if (imageUrl) {
          formData.append('image_url', imageUrl);
        } else if (photoFile) {
          formData.append('photo', photoFile);
        }
        const chatId = this.extractFieldValue(payload.chat_id as FieldValue);
        if (chatId) {
          formData.append('chat_id', chatId);
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
  },
});
