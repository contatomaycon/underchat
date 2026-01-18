<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VForm } from 'vuetify/components/VForm';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { requiredValidator } from '@/@webcore/utils/validators';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { UpdateCreditCardFeeRequest } from '@core/schema/config/updateCreditCardFee/request.schema';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';
import MethodPaymentsTab from './method-payments-tab.vue';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const saving = ref(false);
const refFormCreditCard = ref<VForm>();

const creditCardFee = ref<ListCreditCardFeeResponse | null>(null);

const form = ref<UpdateCreditCardFeeRequest>({
  installment_1_rate: 0,
  installment_2_rate: 0,
  installment_3_rate: 0,
  installment_4_rate: 0,
  installment_5_rate: 0,
  installment_6_rate: 0,
  installment_7_rate: 0,
  installment_8_rate: 0,
  installment_9_rate: 0,
  installment_10_rate: 0,
  installment_11_rate: 0,
  installment_12_rate: 0,
});

const installments = ref<number[]>([]);
for (let i = 1; i <= 12; i += 1) {
  installments.value.push(i);
}

const creditCardEnabled = computed(() => {
  const creditCard = settingsStore.methodPayments?.find(
    (mp) => mp.type === EMethodPayment.credit_card
  );
  return creditCard?.status ?? false;
});

watch(
  () => settingsStore.methodPayments,
  () => {
    if (creditCardEnabled.value) {
      loadCreditCardFee();
    }
  },
  { deep: true }
);

const getInstallmentKey = (
  installment: number
): keyof UpdateCreditCardFeeRequest => {
  return `installment_${installment}_rate` as keyof UpdateCreditCardFeeRequest;
};

const loadCreditCardFee = async () => {
  loading.value = true;
  const result = await settingsStore.getCreditCardFee();
  if (result) {
    creditCardFee.value = result;
    form.value = {
      installment_1_rate: result.installment_1_rate,
      installment_2_rate: result.installment_2_rate,
      installment_3_rate: result.installment_3_rate,
      installment_4_rate: result.installment_4_rate,
      installment_5_rate: result.installment_5_rate,
      installment_6_rate: result.installment_6_rate,
      installment_7_rate: result.installment_7_rate,
      installment_8_rate: result.installment_8_rate,
      installment_9_rate: result.installment_9_rate,
      installment_10_rate: result.installment_10_rate,
      installment_11_rate: result.installment_11_rate,
      installment_12_rate: result.installment_12_rate,
    };
  }
  loading.value = false;
};

const saveCreditCardFee = async () => {
  const validation = await refFormCreditCard.value!.validate();
  if (!validation.valid) return;

  try {
    saving.value = true;
    const result = await settingsStore.updateCreditCardFee(form.value);
    if (result) {
      creditCardFee.value = result;
    }
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  if (!settingsStore.methodPayments) {
    settingsStore.getMethodPayments();
  }
  if (creditCardEnabled.value) {
    loadCreditCardFee();
  }
});
</script>

<template>
  <div>
    <MethodPaymentsTab />

    <VRow v-if="!creditCardEnabled" class="mt-6">
      <VCol cols="12">
        <VAlert type="info" variant="tonal">
          {{ $t('credit_card_method_disabled_message') }}
        </VAlert>
      </VCol>
    </VRow>

    <VRow v-if="creditCardEnabled && loading" class="mt-6">
      <VCol cols="12" class="text-center">
        <VProgressCircular indeterminate color="primary" />
      </VCol>
    </VRow>

    <VRow v-else-if="creditCardEnabled">
      <VCol cols="12">
        <VCard>
          <VCardTitle class="text-h6 pa-6 pb-4">
            {{ $t('credit_card') }}
          </VCardTitle>

          <VDivider />

          <VCardText>
            <VForm ref="refFormCreditCard" @submit.prevent="saveCreditCardFee">
              <VRow>
                <VCol
                  cols="12"
                  md="6"
                  v-for="installment in installments"
                  :key="installment"
                >
                  <VLabel class="text-body-2 mb-1">
                    {{
                      $t('credit_card_installment_rate', {
                        number: installment,
                      })
                    }}
                  </VLabel>
                  <AppTextField
                    v-model="form[getInstallmentKey(installment)]"
                    type="number"
                    step="0.01"
                    :rules="[
                      requiredValidator(
                        form[getInstallmentKey(installment)],
                        $t('field_required')
                      ),
                    ]"
                  />
                </VCol>
              </VRow>

              <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
                <VBtn type="submit" :loading="saving" :disabled="saving">
                  {{ $t('save') }}
                </VBtn>
              </VCardText>
            </VForm>
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
