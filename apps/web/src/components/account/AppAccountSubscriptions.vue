<script lang="ts" setup>
import { useAccountStore } from '@/@webcore/stores/account';
import { usePlanStore } from '@/@webcore/stores/plan';
import { VForm } from 'vuetify/components/VForm';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';

const accountStore = useAccountStore();
const planStore = usePlanStore();
const { t, locale } = useI18n();

type DateOrStringOrNull = Date | string | null;

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
const isSaving = ref<boolean>(false);

const plan_id = ref<string | null>(null);
const recurring_payment = ref<boolean>(false);
const billing_period_id = ref<string | null>(null);
const last_payment_date = ref<DateOrStringOrNull>(null);
const next_payment_date = ref<DateOrStringOrNull>(null);
const cancellation_date = ref<DateOrStringOrNull>(null);
const valueDisplay = ref<string>('');
const valueRaw = ref<number | null>(null);

const itemsPlan = computed(() =>
  planStore.listAll.map((p) => ({
    value: p.plan_id,
    text: p.name,
    is_test: p.is_test,
    days_trial: p.days_trial,
  }))
);

const planSearchQuery = ref('');
const isPlanMenuOpen = ref(false);

const filteredPlans = computed(() => {
  if (!planSearchQuery.value) {
    return itemsPlan.value;
  }
  const query = planSearchQuery.value.toLowerCase();
  return itemsPlan.value.filter((plan) =>
    plan.text.toLowerCase().includes(query)
  );
});

watch(isPlanMenuOpen, (isOpen) => {
  if (!isOpen) {
    planSearchQuery.value = '';
  }
});

const selectedPlan = computed(() => {
  if (!plan_id.value) return null;
  return planStore.listAll.find((p) => p.plan_id === plan_id.value);
});

const isTestPlan = computed(() => selectedPlan.value?.is_test ?? false);

const itemsRecurringPayment = [
  { value: true, text: t('yes') },
  { value: false, text: t('no') },
];

const itemsBillingPeriod = [
  { value: EBillingPeriod.monthly, text: t('monthly') },
  { value: EBillingPeriod.annual, text: t('annual') },
];

const recurringPaymentSearchQuery = ref('');
const isRecurringPaymentMenuOpen = ref(false);

const filteredRecurringPayments = computed(() => {
  if (!recurringPaymentSearchQuery.value) {
    return itemsRecurringPayment;
  }
  const query = recurringPaymentSearchQuery.value.toLowerCase();
  return itemsRecurringPayment.filter((item) =>
    item.text.toLowerCase().includes(query)
  );
});

const billingPeriodSearchQuery = ref('');
const isBillingPeriodMenuOpen = ref(false);

const filteredBillingPeriods = computed(() => {
  if (!billingPeriodSearchQuery.value) {
    return itemsBillingPeriod;
  }
  const query = billingPeriodSearchQuery.value.toLowerCase();
  return itemsBillingPeriod.filter((item) =>
    item.text.toLowerCase().includes(query)
  );
});

watch(isRecurringPaymentMenuOpen, (isOpen) => {
  if (!isOpen) {
    recurringPaymentSearchQuery.value = '';
  }
});

watch(isBillingPeriodMenuOpen, (isOpen) => {
  if (!isOpen) {
    billingPeriodSearchQuery.value = '';
  }
});

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

const formatDateForApi = (date: Date | string | null): string | null => {
  if (!date) return null;
  if (typeof date === 'string') {
    return new Date(date).toISOString();
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  return null;
};

const updatePlanAccount = async () => {
  const validateForm = await refFormPlanAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!plan_id.value) {
    return;
  }

  if (!isTestPlan.value) {
    if (
      recurring_payment.value === null ||
      recurring_payment.value === undefined ||
      !billing_period_id.value ||
      valueRaw.value === null ||
      valueRaw.value === undefined
    ) {
      return;
    }
  }

  isSaving.value = true;

  try {
    const payload: UpdatePlanAccountRequest = {
      plan_id: plan_id.value,
      recurring_payment: isTestPlan.value ? undefined : recurring_payment.value,
      billing_period_id: isTestPlan.value
        ? undefined
        : billing_period_id.value || undefined,
      last_payment_date: formatDateForApi(last_payment_date.value),
      next_payment_date: formatDateForApi(next_payment_date.value),
      cancellation_date: formatDateForApi(cancellation_date.value),
      value: isTestPlan.value
        ? undefined
        : valueRaw.value?.toString() || undefined,
    };

    const result = await accountStore.updatePlanAccount(
      accountId.value!,
      payload
    );

    if (result) {
      isVisible.value = false;
      await accountStore.listAccount();
    }
  } finally {
    isSaving.value = false;
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

watch(plan_id, (newPlanId) => {
  if (newPlanId) {
    const plan = planStore.listAll.find((p) => p.plan_id === newPlanId);
    if (plan?.is_test) {
      recurring_payment.value = false;
      billing_period_id.value = null;
      valueDisplay.value = '';
      valueRaw.value = null;
    }
  }
});

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

    <VOverlay
      :model-value="accountStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormPlanAccount" @submit.prevent>
      <VCard :title="$t('plan')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VDivider class="mb-4" />
              <h3 class="text-h6 mb-4">{{ $t('plan_information') }}</h3>
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="mb-1 text-body-2">{{ $t('plan') }}:</VLabel>
              <VMenu v-model="isPlanMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredPlans.find((plan) => plan.value === plan_id)
                        ?.text || ''
                    "
                    :placeholder="$t('plan')"
                    variant="outlined"
                    readonly
                    :clearable="!!plan_id"
                    clear-icon="tabler-x"
                    @click:clear="plan_id = null"
                    :append-inner-icon="
                      plan_id ? undefined : 'tabler-chevron-down'
                    "
                    :error-messages="
                      !plan_id ? [$t('plan_required')] : undefined
                    "
                  />
                </template>
                <VCard>
                  <VCardText class="pa-2">
                    <AppTextField
                      v-model="planSearchQuery"
                      :placeholder="$t('search') + '...'"
                      prepend-inner-icon="tabler-search"
                      density="compact"
                      hide-details
                      autofocus
                      @click.stop
                    />
                  </VCardText>
                  <VDivider />
                  <VList max-height="300" style="overflow-y: auto">
                    <template v-if="filteredPlans.length > 0">
                      <VListItem
                        v-for="(item, index) in filteredPlans"
                        :key="index"
                        :value="item.value"
                        @click="
                          () => {
                            plan_id = item.value;
                            isPlanMenuOpen = false;
                            planSearchQuery = '';
                          }
                        "
                        :active="plan_id === item.value"
                      >
                        <VListItemTitle>{{ item.text }}</VListItemTitle>
                      </VListItem>
                    </template>
                    <VListItem v-else-if="planSearchQuery" disabled>
                      <VListItemTitle
                        class="text-center text-body-2 text-medium-emphasis"
                      >
                        {{ $t('no_results_found') }}
                      </VListItemTitle>
                    </VListItem>
                  </VList>
                </VCard>
              </VMenu>
            </VCol>

            <VCol v-if="!isTestPlan" cols="12" md="6">
              <VLabel class="mb-1 text-body-2"
                >{{ $t('recurring_payment') }}:</VLabel
              >
              <VMenu v-model="isRecurringPaymentMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredRecurringPayments.find(
                        (item) => item.value === recurring_payment
                      )?.text || ''
                    "
                    :placeholder="$t('recurring_payment')"
                    variant="outlined"
                    readonly
                    :clearable="recurring_payment !== null"
                    clear-icon="tabler-x"
                    @click:clear="recurring_payment = false"
                    :append-inner-icon="
                      recurring_payment !== null
                        ? undefined
                        : 'tabler-chevron-down'
                    "
                    :error-messages="
                      recurring_payment === null
                        ? [$t('recurring_payment_required')]
                        : undefined
                    "
                  />
                </template>
                <VCard>
                  <VCardText class="pa-2">
                    <AppTextField
                      v-model="recurringPaymentSearchQuery"
                      :placeholder="$t('search') + '...'"
                      prepend-inner-icon="tabler-search"
                      density="compact"
                      hide-details
                      autofocus
                      @click.stop
                    />
                  </VCardText>
                  <VDivider />
                  <VList max-height="300" style="overflow-y: auto">
                    <template v-if="filteredRecurringPayments.length > 0">
                      <VListItem
                        v-for="(item, index) in filteredRecurringPayments"
                        :key="index"
                        :value="item.value"
                        @click="
                          () => {
                            recurring_payment = item.value;
                            isRecurringPaymentMenuOpen = false;
                            recurringPaymentSearchQuery = '';
                          }
                        "
                        :active="recurring_payment === item.value"
                      >
                        <VListItemTitle>{{ item.text }}</VListItemTitle>
                      </VListItem>
                    </template>
                    <VListItem v-else-if="recurringPaymentSearchQuery" disabled>
                      <VListItemTitle
                        class="text-center text-body-2 text-medium-emphasis"
                      >
                        {{ $t('no_results_found') }}
                      </VListItemTitle>
                    </VListItem>
                  </VList>
                </VCard>
              </VMenu>
            </VCol>

            <VCol v-if="!isTestPlan" cols="12" md="6">
              <VLabel class="mb-1 text-body-2"
                >{{ $t('billing_period') }}:</VLabel
              >
              <VMenu v-model="isBillingPeriodMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredBillingPeriods.find(
                        (item) => item.value === billing_period_id
                      )?.text || ''
                    "
                    :placeholder="$t('billing_period')"
                    variant="outlined"
                    readonly
                    :clearable="!!billing_period_id"
                    clear-icon="tabler-x"
                    @click:clear="billing_period_id = null"
                    :append-inner-icon="
                      billing_period_id ? undefined : 'tabler-chevron-down'
                    "
                    :error-messages="
                      !billing_period_id
                        ? [$t('billing_period_required')]
                        : undefined
                    "
                  />
                </template>
                <VCard>
                  <VCardText class="pa-2">
                    <AppTextField
                      v-model="billingPeriodSearchQuery"
                      :placeholder="$t('search') + '...'"
                      prepend-inner-icon="tabler-search"
                      density="compact"
                      hide-details
                      autofocus
                      @click.stop
                    />
                  </VCardText>
                  <VDivider />
                  <VList max-height="300" style="overflow-y: auto">
                    <template v-if="filteredBillingPeriods.length > 0">
                      <VListItem
                        v-for="(item, index) in filteredBillingPeriods"
                        :key="index"
                        :value="item.value"
                        @click="
                          () => {
                            billing_period_id = item.value;
                            isBillingPeriodMenuOpen = false;
                            billingPeriodSearchQuery = '';
                          }
                        "
                        :active="billing_period_id === item.value"
                      >
                        <VListItemTitle>{{ item.text }}</VListItemTitle>
                      </VListItem>
                    </template>
                    <VListItem v-else-if="billingPeriodSearchQuery" disabled>
                      <VListItemTitle
                        class="text-center text-body-2 text-medium-emphasis"
                      >
                        {{ $t('no_results_found') }}
                      </VListItemTitle>
                    </VListItem>
                  </VList>
                </VCard>
              </VMenu>
            </VCol>

            <VCol v-if="!isTestPlan" cols="12" md="6">
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
          <VBtn :loading="isSaving" @click="updatePlanAccount">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
