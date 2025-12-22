import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  EditAccountParamsRequest,
  UpdateAccountRequest,
} from '@core/schema/account/editAccount/request.schema';
import {
  ListAccountFinalResponse,
  ListAccountResponse,
} from '@core/schema/account/listAccount/response.schema';
import { IListAccounts } from '../interfaces/IListAccounts';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';
import { ViewAccountResponse } from '@core/schema/account/viewAccount/response.schema';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { ViewAccountInfoResponse } from '@core/schema/account/viewAccountInfo/response.schema';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';
import { ListAccountSubscriptionsResponse } from '@core/schema/account/listAccountSubscriptions/response.schema';
import { ViewPlanAccountResponse } from '@core/schema/planAccount/viewPlanAccount/response.schema';
import { ListPlanAccountExclusivesResponse } from '@core/schema/planAccountExclusive/listPlanAccountExclusive/response.schema';
import { ListExclusivePlansResponseArray } from '@core/schema/planAccountExclusive/listExclusivePlans/response.schema';

export const useAccountStore = defineStore('account', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListAccountResponse[],
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

    async listAccount(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountSubscribers(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/subscribers`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountCancelling(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/cancelling`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountCancelled(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/cancelled`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountTests(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/tests`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountBlocked(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/blocked`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountExpired(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/expired`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAccountDeleted(
      input?: IListAccounts
    ): Promise<ListAccountFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAccountRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              plan: input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAccountFinalResponse>
        >(`/account/deleted`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAllAccounts(): Promise<IAccountBasic[]> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<IAccountBasic[]>>(`/account/all`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_all_list_error');

          this.showSnackbar(mensage, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_all_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return [];
      }
    },

    async getAccountById(
      accountId: string
    ): Promise<ViewAccountResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewAccountResponse>>(
          `/account/${accountId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addAccount(payload: CreateAccountRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/account`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('account_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateAccount(
      payload: EditAccountParamsRequest,
      body: UpdateAccountRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/account/${payload.account_id}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('account_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async blockAccount(accountId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/account/${accountId}/block`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_block_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('account_blocked_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_block_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async unblockAccount(accountId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/account/${accountId}/unblock`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_unblock_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('account_unblocked_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_unblock_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteAccount(accountId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/account/${accountId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_deleted_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('account_deleted_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_deleted_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getAccountInfoById(): Promise<ViewAccountInfoResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewAccountInfoResponse>>(
          '/account-settings/account-info'
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_info_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('account_info_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async saveAccountInfo(body: FormData): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.put<IApiResponse<{ created: boolean }>>(
          `/account-settings/account-info`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('account_info_update_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('account_info_update_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('account_info_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async getAccountSubscriptions(
      accountId: string
    ): Promise<ListAccountSubscriptionsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListAccountSubscriptionsResponse>
        >(`/account/${accountId}/subscriptions`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ??
            this.i18n.global.t('account_subscriptions_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'account_subscriptions_list_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async getPlanAccountExclusives(
      accountId: string
    ): Promise<ListPlanAccountExclusivesResponse> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListPlanAccountExclusivesResponse>
        >(`/account/${accountId}/exclusive-plans`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ??
            this.i18n.global.t('plan_account_exclusive_list_error');

          this.showSnackbar(mensage, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'plan_account_exclusive_list_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return [];
      }
    },

    async getExclusivePlans(
      accountId: string
    ): Promise<ListExclusivePlansResponseArray> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListExclusivePlansResponseArray>
        >(`/account/${accountId}/exclusive-plans/available`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('exclusive_plans_list_error');

          this.showSnackbar(mensage, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('exclusive_plans_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return [];
      }
    },

    async createPlanAccountExclusive(input: {
      account_id: string;
      plan_id: string;
    }): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<{ plan_account_exclusive_id: string }>
        >(`/account/exclusive-plan`, input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('plan_account_exclusive_creation_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_account_exclusive_created_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'plan_account_exclusive_creation_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deletePlanAccountExclusive(
      planAccountExclusiveId: string
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/account/exclusive-plan/${planAccountExclusiveId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('plan_account_exclusive_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_account_exclusive_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'plan_account_exclusive_delete_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getPlanAccount(
      accountId: string
    ): Promise<ViewPlanAccountResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewPlanAccountResponse>>(
          `/account/${accountId}/plan-account`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },

    async updatePlanAccount(accountId: string, payload: any): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/account/${accountId}/plan-account`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('plan_account_update_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_account_update_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_account_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async listMasterAccessibleAccounts(): Promise<IAccountBasic[]> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<IAccountBasic[]>>(
          `/master-session/accounts`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('master_accounts_list_error');

          this.showSnackbar(mensage, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('master_accounts_list_error');
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
