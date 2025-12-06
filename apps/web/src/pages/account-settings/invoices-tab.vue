<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import TablePagination from '@/@webcore/components/TablePagination.vue';

const { t } = useI18n();
const accountSettingsStore = useAccountSettingsStore();

const options = ref({
  page: 1,
  itemsPerPage: 10,
});

const expanded = ref<string[]>([]);

const query = computed(() => ({
  current_page: options.value.page,
  per_page: options.value.itemsPerPage,
}));

const getPaymentBillingTypeIcon = (typeName: string): string => {
  const iconMap: Record<string, string> = {
    BOLETO: 'tabler-file-invoice',
    CREDIT_CARD: 'tabler-credit-card',
    DEBIT_CARD: 'tabler-credit-card-off',
    PIX: 'tabler-qrcode',
    TRANSFER: 'tabler-transfer',
    DEPOSIT: 'tabler-building-bank',
  };
  return iconMap[typeName] || 'tabler-currency-dollar';
};

const getPaymentBillingTypeLabel = (typeName: string): string => {
  const translationKey = `payment_billing_type_${typeName.toLowerCase()}`;
  return t(translationKey, typeName);
};

const getPaymentStatusLabel = (statusName: string): string => {
  const translationKey = `payment_status_${statusName.toLowerCase()}`;
  return t(translationKey, statusName);
};

const getPaymentStatusColor = (statusName: string): string => {
  const statusMap: Record<string, string> = {
    PENDING: 'warning',
    RECEIVED: 'success',
    CONFIRMED: 'success',
    OVERDUE: 'error',
    REFUNDED: 'info',
    RECEIVED_IN_CASH: 'success',
    REFUND_REQUESTED: 'warning',
    REFUND_IN_PROGRESS: 'warning',
    CHARGEBACK_REQUESTED: 'error',
    CHARGEBACK_DISPUTE: 'error',
    AWAITING_CHARGEBACK_REVERSAL: 'warning',
    DUNNING_REQUESTED: 'warning',
    DUNNING_RECEIVED: 'success',
    AWAITING_RISK_ANALYSIS: 'warning',
  };
  return statusMap[statusName] || 'default';
};

const formatCurrency = (value: string): string => {
  const numValue = Number.parseFloat(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numValue);
};

const formatDate = (date: string | null): string => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatPaymentId = (uuid: string): string => {
  if (!uuid) return '-';
  return uuid.slice(-8).toUpperCase();
};

const handleTableChange = (o: { page: number; itemsPerPage: number }) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
};

watch(
  query,
  async (q) => {
    await accountSettingsStore.listAccountPayments(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard variant="elevated" class="account-settings-card">
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('invoices') }}
      </VCardTitle>
      <VDivider />
      <VCardText>
        <VDataTableServer
          v-model:page="options.page"
          v-model:items-per-page="options.itemsPerPage"
          :headers="[
            {
              title: '',
              key: 'data-table-expand',
              sortable: false,
              width: '48px',
            },
            {
              title: 'ID',
              key: 'account_payment_id',
              sortable: false,
            },
            {
              title: $t('payment_type'),
              key: 'payment_billing_type',
              sortable: false,
            },
            {
              title: $t('plan_name'),
              key: 'plan_name',
              sortable: false,
            },
            {
              title: $t('value'),
              key: 'value',
              sortable: false,
            },
            {
              title: $t('status'),
              key: 'payment_status',
              sortable: false,
            },
            {
              title: $t('payment_date'),
              key: 'payment_date',
              sortable: false,
            },
            {
              title: $t('created_at'),
              key: 'created_at',
              sortable: false,
            },
            {
              title: $t('actions'),
              key: 'actions',
              sortable: false,
              align: 'end',
            },
          ]"
          :items="accountSettingsStore.accountPaymentsList"
          :items-length="accountSettingsStore.accountPaymentsPagings.total"
          :loading="accountSettingsStore.loading"
          @update:options="handleTableChange"
          :loading-text="$t('loading_text')"
          :show-expand="false"
        >
          <template #item="{ item, columns }">
            <tr>
              <template v-for="column in columns" :key="column.key">
                <td v-if="column.key === 'data-table-expand'">
                  <VBtn
                    v-if="item.cross_sells && item.cross_sells.length > 0"
                    icon
                    variant="text"
                    size="small"
                    @click="
                      expanded.includes(item.account_payment_id)
                        ? expanded.splice(
                            expanded.indexOf(item.account_payment_id),
                            1
                          )
                        : expanded.push(item.account_payment_id)
                    "
                  >
                    <VIcon
                      :icon="
                        expanded.includes(item.account_payment_id)
                          ? 'tabler-chevron-down'
                          : 'tabler-chevron-right'
                      "
                      size="20"
                    />
                  </VBtn>
                </td>
                <td v-else-if="column.key === 'account_payment_id'">
                  <VTooltip>
                    <template #activator="{ props }">
                      <span v-bind="props" class="text-caption font-mono">
                        {{ formatPaymentId(item.account_payment_id) }}
                      </span>
                    </template>
                    <span>{{ item.account_payment_id }}</span>
                  </VTooltip>
                </td>
                <td v-else-if="column.key === 'payment_billing_type'">
                  <div class="d-flex align-center gap-2">
                    <VIcon
                      :icon="
                        getPaymentBillingTypeIcon(
                          item.payment_billing_type_name
                        )
                      "
                      size="20"
                    />
                    <span>{{
                      getPaymentBillingTypeLabel(item.payment_billing_type_name)
                    }}</span>
                  </div>
                </td>
                <td v-else-if="column.key === 'plan_name'">
                  <div class="d-flex align-center gap-2">
                    <VIcon
                      v-if="item.plan_icon"
                      :icon="item.plan_icon"
                      size="20"
                    />
                    <span>{{ item.plan_name }}</span>
                  </div>
                </td>
                <td v-else-if="column.key === 'value'">
                  {{ formatCurrency(item.value) }}
                </td>
                <td v-else-if="column.key === 'payment_status'">
                  <VChip
                    :color="getPaymentStatusColor(item.payment_status_name)"
                    variant="tonal"
                    size="small"
                  >
                    {{ getPaymentStatusLabel(item.payment_status_name) }}
                  </VChip>
                </td>
                <td v-else-if="column.key === 'payment_date'">
                  {{ formatDate(item.payment_date) }}
                </td>
                <td v-else-if="column.key === 'created_at'">
                  {{ formatDate(item.created_at) }}
                </td>
                <td v-else-if="column.key === 'actions'">
                  <VBtn
                    v-if="item.invoice_url"
                    icon
                    variant="text"
                    size="small"
                    :href="item.invoice_url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <VIcon icon="tabler-eye" size="20" />
                    <VTooltip activator="parent" location="top">
                      {{ $t('view_invoice') }}
                    </VTooltip>
                  </VBtn>
                </td>
              </template>
            </tr>
            <VExpandTransition>
              <tr
                v-if="
                  expanded.includes(item.account_payment_id) &&
                  item.cross_sells &&
                  item.cross_sells.length > 0
                "
              >
                <td :colspan="9">
                  <div class="pa-4">
                    <div class="text-h6 mb-4">{{ $t('addons') }}</div>
                    <VTable>
                      <thead>
                        <tr>
                          <th>{{ $t('name') }}</th>
                          <th>{{ $t('quantity') }}</th>
                          <th>{{ $t('value') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(addon, index) in item.cross_sells"
                          :key="index"
                        >
                          <td>{{ addon.name }}</td>
                          <td>{{ addon.quantity }}</td>
                          <td>{{ formatCurrency(addon.value) }}</td>
                        </tr>
                      </tbody>
                    </VTable>
                  </div>
                </td>
              </tr>
            </VExpandTransition>
          </template>

          <template #no-data>
            <div class="text-center py-8">
              <VIcon icon="tabler-receipt-off" size="48" class="mb-4" />
              <p class="text-body-1">{{ $t('no_invoices_found') }}</p>
            </div>
          </template>

          <template #bottom>
            <TablePagination
              v-model:page="options.page"
              :items-per-page="options.itemsPerPage"
              :total-items="accountSettingsStore.accountPaymentsPagings.total"
            />
          </template>
        </VDataTableServer>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.account-settings-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px;
}
</style>
