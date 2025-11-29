import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { ChatboxUserResponse } from '@core/schema/chatbox/listUsers/response.schema';
import { ChatboxSectorResponse } from '@core/schema/chatbox/listSectors/response.schema';
import { ChatboxSectorUserResponse } from '@core/schema/chatbox/listSectorUsers/response.schema';

export const useChatboxStore = defineStore('chatbox', {
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

    async listChatboxUsers(): Promise<ChatboxUserResponse[]> {
      try {
        const response =
          await axios.get<IApiResponse<ChatboxUserResponse[]>>(
            '/chatbox/users'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbox_users') ||
          'Erro ao carregar usuários do chatbox';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listChatboxSectors(): Promise<ChatboxSectorResponse[]> {
      try {
        const response =
          await axios.get<IApiResponse<ChatboxSectorResponse[]>>(
            '/chatbox/sectors'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbox_sectors') ||
          'Erro ao carregar setores do chatbox';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listChatboxSectorUsers(
      sectorId: string
    ): Promise<ChatboxSectorUserResponse[]> {
      try {
        const response = await axios.get<
          IApiResponse<ChatboxSectorUserResponse[]>
        >(`/chatbox/sectors/${sectorId}/users`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbox_sector_users') ||
          'Erro ao carregar usuários do setor do chatbox';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },
  },
});
