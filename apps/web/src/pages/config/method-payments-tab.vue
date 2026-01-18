<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListMethodPaymentsResponse } from '@core/schema/config/listMethodPayments/response.schema';
import { UpdateMethodPaymentRequest } from '@core/schema/config/updateMethodPayment/request.schema';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const saving = ref<Record<string, boolean>>({});

const methodPayments = ref<ListMethodPaymentsResponse>([]);

const creditCardEnabled = computed(() => {
  const creditCard = methodPayments.value.find(
    (mp) => mp.type === EMethodPayment.credit_card
  );
  return creditCard?.status ?? false;
});

const loadMethodPayments = async () => {
  loading.value = true;
  const result = await settingsStore.getMethodPayments();
  if (result) {
    methodPayments.value = result;
  }
  loading.value = false;
};

const toggleMethodPayment = async (
  methodPaymentId: string,
  currentStatus: boolean
) => {
  saving.value[methodPaymentId] = true;
  const updateRequest: UpdateMethodPaymentRequest = {
    method_payment_id: methodPaymentId,
    status: !currentStatus,
  };

  const result = await settingsStore.updateMethodPayment(updateRequest);
  if (result) {
    const index = methodPayments.value.findIndex(
      (mp) => mp.method_payment_id === methodPaymentId
    );
    if (index !== -1) {
      methodPayments.value[index] = result;
    }
  }
  saving.value[methodPaymentId] = false;
};

const getMethodLabel = (type: string): string => {
  if (type === EMethodPayment.boleto) {
    return t('boleto');
  }
  if (type === EMethodPayment.credit_card) {
    return t('credit_card');
  }
  if (type === EMethodPayment.pix) {
    return t('pix');
  }
  return type;
};

const getMethodIcon = (type: string): string => {
  if (type === EMethodPayment.boleto) {
    return 'tabler-receipt';
  }
  if (type === EMethodPayment.credit_card) {
    return 'tabler-credit-card';
  }
  if (type === EMethodPayment.pix) {
    return 'tabler-qrcode';
  }
  return 'tabler-credit-card';
};

const getMethodDescription = (type: string): string => {
  if (type === EMethodPayment.boleto) {
    return t('boleto_description');
  }
  if (type === EMethodPayment.credit_card) {
    return t('credit_card_description');
  }
  if (type === EMethodPayment.pix) {
    return t('pix_description');
  }
  return '';
};

onMounted(() => {
  loadMethodPayments();
});
</script>

<template>
  <div>
    <VRow v-if="loading">
      <VCol cols="12" class="text-center">
        <VProgressCircular indeterminate color="primary" />
      </VCol>
    </VRow>

    <VRow v-else>
      <VCol cols="12">
        <VCard>
          <VCardTitle class="text-h6 pa-6 pb-4">
            {{ $t('payment_methods') }}
          </VCardTitle>

          <VDivider />

          <VCardText class="pa-6">
            <div
              v-for="(methodPayment, index) in methodPayments"
              :key="methodPayment.method_payment_id"
              :class="index < methodPayments.length - 1 ? 'mb-6' : ''"
            >
              <div class="d-flex align-center justify-space-between">
                <div class="d-flex align-center gap-4 flex-1">
                  <VIcon
                    :icon="getMethodIcon(methodPayment.type)"
                    size="32"
                    :color="methodPayment.status ? 'primary' : 'disabled'"
                  />
                  <div class="flex-1">
                    <VLabel class="text-body-1 font-weight-medium d-block mb-1">
                      {{ getMethodLabel(methodPayment.type) }}
                    </VLabel>
                    <span
                      class="text-body-2 text-medium-emphasis d-block"
                      v-if="getMethodDescription(methodPayment.type)"
                    >
                      {{ getMethodDescription(methodPayment.type) }}
                    </span>
                  </div>
                </div>
                <VSwitch
                  :model-value="methodPayment.status"
                  :loading="saving[methodPayment.method_payment_id]"
                  color="primary"
                  hide-details
                  @update:model-value="
                    toggleMethodPayment(
                      methodPayment.method_payment_id,
                      methodPayment.status
                    )
                  "
                />
              </div>
              <VDivider
                v-if="index < methodPayments.length - 1"
                class="mt-6"
              />
            </div>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VSnackbar
      v-model="settingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="settingsStore.snackbar.color"
    >
      {{ settingsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>
