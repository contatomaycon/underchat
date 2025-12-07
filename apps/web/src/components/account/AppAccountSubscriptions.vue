<script lang="ts" setup>
import { useAccountStore } from '@/@webcore/stores/account';
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';

const accountStore = useAccountStore();
const planStore = usePlanStore();
const { t, locale } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  accountId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const accountId = toRef(props, 'accountId');
const refFormPlanAccount = ref<VForm>();

const plan_id = ref<string | null>(null);
const recurring_payment = ref<boolean>(false);
const billing_period_id = ref<string | null>(null);
const last_payment_date = ref<Date | null>(null);
const next_payment_date = ref<Date | null>(null);
const cancellation_date = ref<Date | null>(null);
const valueDisplay = ref<string>('');
const valueRaw = ref<number | null>(null);

const itemsPlan = computed(() =>
  planStore.listAll.map((p) => ({
    value: p.plan_id,
    text: p.name,
  }))
);

const itemsRecurringPayment = [
  { value: true, text: t('yes') },
  { value: false, text: t('no') },
];

const itemsBillingPeriod = [
  { value: EBillingPeriod.monthly, text: t('monthly') },
  { value: EBillingPeriod.annual, text: t('annual') },
];

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const removeInvalidChars = (value: string, allowedChars: string): string => {
  return value
    .split('')
    .filter((char) => {
      const code = char.codePointAt(0);
      return (
        (code !== undefined && code >= 48 && code <= 57) ||
        allowedChars.includes(char)
      );
    })
    .join('');
};

const parseCurrency = (value: string): number | null => {
  if (!value) return null;
  const config = getCurrencyConfig();
  let cleanValue = removeInvalidChars(value, '.,-');

  if (config.currency === 'BRL') {
    cleanValue = cleanValue.replaceAll('.', '');
    const commaIndex = cleanValue.indexOf(',');
    if (commaIndex !== -1) {
      cleanValue =
        cleanValue.substring(0, commaIndex) +
        '.' +
        cleanValue.substring(commaIndex + 1);
    }
  } else if (config.currency === 'USD' || config.currency === 'EUR') {
    cleanValue = cleanValue.replaceAll(',', '');
  }

  const parsed = Number.parseFloat(cleanValue);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatCurrencyForInput = (value: string | null): string => {
  if (!value) return '';
  const numValue = Number.parseFloat(value);
  if (Number.isNaN(numValue)) return '';
  const config = getCurrencyConfig();

  if (config.currency === 'BRL') {
    return numValue.toFixed(2).replace('.', ',');
  }

  return numValue.toFixed(2);
};

const handleValueInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  let value = target.value;

  const config = getCurrencyConfig();

  if (config.currency === 'BRL') {
    value = removeInvalidChars(value, ',');
    const parts = value.split(',');
    if (parts.length > 2) {
      value = parts[0] + ',' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + ',' + parts[1].substring(0, 2);
    }
  } else {
    value = removeInvalidChars(value, '.');
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + '.' + parts[1].substring(0, 2);
    }
  }

  valueDisplay.value = value;
  valueRaw.value = parseCurrency(value);
};

const formatDateForInput = (dateString: string | null): Date | null => {
  if (!dateString) return null;
  return new Date(dateString);
};

const formatDateForApi = (date: Date | null): string | null => {
  if (!date) return null;
  return date.toISOString();
};

const updatePlanAccount = async () => {
  const validateForm = await refFormPlanAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !plan_id.value ||
    recurring_payment.value === null ||
    recurring_payment.value === undefined ||
    !billing_period_id.value ||
    valueRaw.value === null ||
    valueRaw.value === undefined
  ) {
    return;
  }

  const payload: UpdatePlanAccountRequest = {
    plan_id: plan_id.value,
    recurring_payment: recurring_payment.value,
    billing_period_id: billing_period_id.value,
    last_payment_date: formatDateForApi(last_payment_date.value),
    next_payment_date: formatDateForApi(next_payment_date.value),
    cancellation_date: formatDateForApi(cancellation_date.value),
    value: valueRaw.value.toString(),
  };

  const result = await accountStore.updatePlanAccount(
    accountId.value!,
    payload
  );

  if (result) {
    isVisible.value = false;
    await accountStore.listAccount();
  }
};

const resetForm = () => {
  plan_id.value = null;
  recurring_payment.value = false;
  billing_period_id.value = null;
  last_payment_date.value = null;
  next_payment_date.value = null;
  cancellation_date.value = null;
  valueDisplay.value = '';
  valueRaw.value = null;
  refFormPlanAccount.value?.resetValidation();
};

const loadPlanAccountData = async () => {
  if (!accountId.value) return;

  if (!planStore.listAll.length) {
    await planStore.listPlanAll();
  }

  const planAccountData = await accountStore.getPlanAccount(accountId.value);

  if (planAccountData) {
    plan_id.value = planAccountData.plan_id;
    recurring_payment.value = planAccountData.recurring_payment;
    billing_period_id.value = planAccountData.billing_period_id;
    last_payment_date.value = formatDateForInput(
      planAccountData.last_payment_date
    );
    next_payment_date.value = formatDateForInput(
      planAccountData.next_payment_date
    );
    cancellation_date.value = formatDateForInput(
      planAccountData.cancellation_date
    );
    valueDisplay.value = formatCurrencyForInput(planAccountData.value);
    valueRaw.value = planAccountData.value
      ? Number.parseFloat(planAccountData.value)
      : null;
  }
};

watch([isVisible, accountId], async ([visible, id]) => {
  if (visible && id) {
    resetForm();
    await loadPlanAccountData();
  }
});

onMounted(async () => {
  if (isVisible.value && accountId.value) {
    resetForm();
    await loadPlanAccountData();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="900">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="accountStore.loading">
      <VOverlay
        :model-value="accountStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormPlanAccount" @submit.prevent>
      <VCard :title="$t('plan')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VDivider class="mb-4" />
              <h3 class="text-h6 mb-4">{{ $t('plan_information') }}</h3>
            </VCol>

            <VCol cols="12" md="6">
              <AppSelect
                v-model="plan_id"
                :items="itemsPlan"
                item-title="text"
                item-value="value"
                :label="$t('plan') + ':'"
                :placeholder="$t('plan')"
                :rules="[requiredValidator(plan_id, $t('plan_required'))]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppSelect
                v-model="recurring_payment"
                :items="itemsRecurringPayment"
                item-title="text"
                item-value="value"
                :label="$t('recurring_payment') + ':'"
                :placeholder="$t('recurring_payment')"
                :rules="[
                  requiredValidator(
                    recurring_payment !== null,
                    $t('recurring_payment_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppSelect
                v-model="billing_period_id"
                :items="itemsBillingPeriod"
                item-title="text"
                item-value="value"
                :label="$t('billing_period') + ':'"
                :placeholder="$t('billing_period')"
                :rules="[
                  requiredValidator(
                    billing_period_id,
                    $t('billing_period_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppTextField
                :model-value="valueDisplay"
                @input="handleValueInput"
                :label="$t('value') + ':'"
                :placeholder="$t('value')"
                :rules="[
                  requiredValidator(
                    valueRaw !== null && valueRaw !== undefined,
                    $t('value_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12">
              <VDivider class="my-4" />
              <h3 class="text-h6 mb-4">{{ $t('payment_dates') }}</h3>
            </VCol>

            <VCol cols="12" md="4">
              <AppDateTimePicker
                v-model="last_payment_date"
                :label="$t('last_payment_date') + ':'"
                :placeholder="$t('last_payment_date')"
              />
            </VCol>

            <VCol cols="12" md="4">
              <AppDateTimePicker
                v-model="next_payment_date"
                :label="$t('next_payment_date') + ':'"
                :placeholder="$t('next_payment_date')"
              />
            </VCol>

            <VCol cols="12" md="4">
              <AppDateTimePicker
                v-model="cancellation_date"
                :label="$t('cancellation_date') + ':'"
                :placeholder="$t('cancellation_date')"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updatePlanAccount"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
