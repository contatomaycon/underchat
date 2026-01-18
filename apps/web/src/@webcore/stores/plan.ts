import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListPlanFinalResponse,
  ListPlanResponse,
} from '@core/schema/plan/listPlan/response.schema';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { IListPlans } from '../interfaces/IListPlans';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';
import { ListPlanProductAllResponse } from '@core/schema/plan/listPlanProductAll/response.schema';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import { CreateOrderPaymentResponse } from '@core/schema/plan/createOrderPayment/response.schema';
import {
  ListPlanSalesFinalResponse,
  ListPlanSalesResponse,
} from '@core/schema/plan/listPlanSales/response.schema';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { IListPlanSales } from '../interfaces/IListPlanSales';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { ListMethodPaymentsResponse } from '@core/schema/plan/listMethodPayments/response.schema';

export const usePlanStore = defineStore('plan', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListPlanResponse[],
    listAll: [] as ListPlanAllResponse[],
    listProductAll: [] as ListPlanProductAllResponse[],
    listProductWithPrice: [] as ListPlanProductWithPriceResponse[],
    userCards: [] as ListUserCardResponse[],
    listSales: [] as ListPlanSalesResponse[],
    listWithItems: [] as ListPlanWithItemsResponse[],
    availableCrossSells: [] as ListAvailableCrossSellResponse[],
    creditCardFee: null as ListCreditCardFeeResponse | null,
    methodPayments: [] as ListMethodPaymentsResponse,
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

    async listPlan(input?: IListPlans): Promise<ListPlanFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListPlanRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              price: input.search,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListPlanFinalResponse>>(
          `/plan`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('plan_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listPlanAll(): Promise<ListPlanAllResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListPlanAllResponse[]>>('/plan/all');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_all_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.listAll = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_all_list_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async createPlan(input: CreatePlanRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<null>>('/plan', input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('plan_creation_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_created_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_creation_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async updatePlan(
      planId: string,
      input: UpdatePlanRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          `/plan/${planId}`,
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('plan_update_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_updated_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_update_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async deletePlan(planId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/plan/${planId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('plan_delete_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_delete_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async createPlanItem(input: CreatePlanItemRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<null>>(
          '/plan/item',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('plan_item_creation_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_item_added_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_item_creation_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async listPlanItems(planId: string): Promise<ListPlanItemResponse[]> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ListPlanItemResponse[]>>(
          `/plan/${planId}/items`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_items_list_error');

          this.showSnackbar(message, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_items_list_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return [];
      }
    },

    async deletePlanItem(planItemId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/plan/item/${planItemId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('plan_item_delete_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('plan_item_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_item_delete_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async listPlanProductAll(): Promise<ListPlanProductAllResponse[]> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListPlanProductAllResponse[]>>(
            '/plan/product/all'
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_product_list_all_error');

          this.showSnackbar(message, EColor.error);

          return [];
        }

        this.listProductAll = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_product_list_all_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return [];
      }
    },

    async listPlanProductWithPrice(): Promise<
      ListPlanProductWithPriceResponse[]
    > {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListPlanProductWithPriceResponse[]>
        >('/plan/product/with-price');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_product_list_all_error');

          this.showSnackbar(message, EColor.error);

          return [];
        }

        this.listProductWithPrice = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_product_list_all_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return [];
      }
    },

    async listUserCards(): Promise<ListUserCardResponse[]> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListUserCardResponse[]>>(
            '/plan/user-cards'
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('user_cards_list_error');

          this.showSnackbar(message, EColor.error);

          return [];
        }

        this.userCards = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_cards_list_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return [];
      }
    },

    async listPlanSales(
      input?: IListPlanSales
    ): Promise<ListPlanSalesFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListPlanSalesRequest | undefined = input
          ? {
              plan_id: input.plan_id,
              start_date: input.start_date,
              end_date: input.end_date,
              payment_billing_type_id: input.payment_billing_type_id,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListPlanSalesFinalResponse>
        >('/plan/sales', {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_sales_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.listSales = data.data.results;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_sales_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listPlanWithItems(): Promise<ListPlanWithItemsResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListPlanWithItemsResponse[]>>(
            '/plan/with-items'
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_list_with_items_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.listWithItems = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_list_with_items_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async getCurrentPlan(): Promise<string | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<{ plan_id: string | null }>>(
            '/plan/current-plan'
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.plan_id;
      } catch {
        this.loading = false;
        return null;
      }
    },

    async checkTestPlanAlreadyUsed(): Promise<boolean> {
      try {
        const response = await axios.get<
          IApiResponse<{ already_used: boolean }>
        >('/plan/check-test-already-used');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return false;
        }

        return data.data.already_used;
      } catch {
        return false;
      }
    },

    async viewUserInfo(): Promise<ViewUserInfoResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ViewUserInfoResponse>>(
            '/plan/user-info'
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('user_info_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_info_view_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async calculateUpgradeDiscount(
      planId: string,
      billingPeriod?: 'monthly' | 'annual'
    ): Promise<CalculateUpgradeDiscountResponse | null> {
      try {
        this.loading = true;

        const queryParams = new URLSearchParams({ plan_id: planId });
        if (billingPeriod) {
          queryParams.append('billing_period', billingPeriod);
        }

        const response = await axios.get<
          IApiResponse<CalculateUpgradeDiscountResponse>
        >(`/plan/upgrade-discount?${queryParams.toString()}`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ??
            this.i18n.global.t('upgrade_discount_calculation_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'upgrade_discount_calculation_error'
        );

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async createOrderPayment(
      input: CreateOrderPaymentRequest
    ): Promise<CreateOrderPaymentResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<CreateOrderPaymentResponse>
        >('/plan/order/payment', input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('order_payment_creation_failed');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data || null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('order_payment_creation_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async getCreditCardFee(): Promise<ListCreditCardFeeResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListCreditCardFeeResponse>
        >('/plan/credit-card-fee');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('credit_card_fee_not_found');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.creditCardFee = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('credit_card_fee_update_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async getMethodPayments(): Promise<ListMethodPaymentsResponse> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListMethodPaymentsResponse>
        >('/plan/method-payments');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.methodPayments = [];
          return [];
        }

        this.methodPayments = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('no_enabled_payment_methods');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;
        this.methodPayments = [];

        return [];
      }
    },

    async listAvailableCrossSell(): Promise<ListAvailableCrossSellResponse[]> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListAvailableCrossSellResponse[]>
        >('/plan/cross-sell/available');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('cross_sell_list_error');

          this.showSnackbar(message, EColor.error);

          return [];
        }

        this.availableCrossSells = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('cross_sell_list_error');
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
