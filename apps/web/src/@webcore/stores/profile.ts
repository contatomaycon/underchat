import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosRequestConfig, AxiosError } from 'axios';
import { setUser } from '@/@webcore/localStorage/user';
import { useChatStore } from './chat';

export const useProfileStore = defineStore('profile', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
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
    async uploadUserPhoto(
      userId: string,
      photo: File
    ): Promise<{ photo: string | null } | null> {
      if (!userId) return null;

      try {
        this.loading = true;

        const formData = new FormData();
        formData.append('photo', photo);

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<
          IApiResponse<{ photo: string | null }>
        >(`/user/${userId}/photo`, formData, config);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_photo_upload_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        const chatStore = useChatStore();
        if (chatStore.user?.info && data.data) {
          chatStore.user.info.photo = data.data.photo;
          setUser(chatStore.user);
        }

        this.showSnackbar(
          data.message || this.i18n.global.t('profile_photo_upload_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage =
          this.i18n.global.t('profile_photo_upload_error') ||
          'Erro ao fazer upload da foto do perfil';

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },
    async removeUserPhoto(
      userId: string
    ): Promise<{ photo: string | null } | null> {
      if (!userId) return null;

      try {
        this.loading = true;

        const response = await axios.delete<
          IApiResponse<{ photo: string | null }>
        >(`/user/${userId}/photo`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_photo_remove_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        const chatStore = useChatStore();
        if (chatStore.user?.info && data.data) {
          chatStore.user.info.photo = data.data.photo;
          setUser(chatStore.user);
        }

        this.showSnackbar(
          data.message || this.i18n.global.t('profile_photo_remove_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage =
          this.i18n.global.t('profile_photo_remove_error') ||
          'Erro ao remover a foto do perfil';

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },
  },
});
