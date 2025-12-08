<script lang="ts" setup>
import { useAccountStore } from '@/@webcore/stores/account';
import { usePlanStore } from '@/@webcore/stores/plan';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { VForm } from 'vuetify/components/VForm';

const accountStore = useAccountStore();
const planStore = usePlanStore();

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const itemsStatus = ref([
  { value: EAccountStatus.active, text: t('active') },
  { value: EAccountStatus.inactive, text: t('inactive') },
  { value: EAccountStatus.blocked, text: t('blocked') },
]);

const itemsPlan = computed(() =>
  planStore.listAll.map((p) => ({
    value: p.plan_id,
    text: p.name,
    is_test: p.is_test,
    days_trial: p.days_trial,
  }))
);

const selectedPlan = computed(() => {
  if (!plan_id.value) return null;
  return planStore.listAll.find((p) => p.plan_id === plan_id.value);
});

const isTestPlan = computed(() => selectedPlan.value?.is_test ?? false);

const name = ref<string | null>(null);
const account_status_id = ref<string | null>(EAccountStatus.active);
const plan_id = ref<string | null>(null);
const billing_period = ref<'monthly' | 'annual' | null>(null);

const refFormAddAccount = ref<VForm>();

const itemsBillingPeriod = [
  { value: 'monthly', text: t('monthly') },
  { value: 'annual', text: t('annual') },
];

const statusSearchQuery = ref('');
const isStatusMenuOpen = ref(false);

const filteredStatuses = computed(() => {
  if (!statusSearchQuery.value) {
    return itemsStatus.value;
  }
  const query = statusSearchQuery.value.toLowerCase();
  return itemsStatus.value.filter((status) =>
    status.text.toLowerCase().includes(query)
  );
});

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

watch(isStatusMenuOpen, (isOpen) => {
  if (!isOpen) {
    statusSearchQuery.value = '';
  }
});

watch(isPlanMenuOpen, (isOpen) => {
  if (!isOpen) {
    planSearchQuery.value = '';
  }
});

watch(isBillingPeriodMenuOpen, (isOpen) => {
  if (!isOpen) {
    billingPeriodSearchQuery.value = '';
  }
});

const showBillingPeriod = computed(() => !!plan_id.value && !isTestPlan.value);

const addAccount = async () => {
  const validateForm = await refFormAddAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value || !account_status_id.value) {
    return;
  }

  if (plan_id.value && !isTestPlan.value && !billing_period.value) {
    return;
  }

  const payload: CreateAccountRequest = {
    name: name.value,
    account_status: {
      account_status_id: account_status_id.value,
    },
  };

  if (plan_id.value) {
    if (isTestPlan.value) {
      payload.plan = {
        plan_id: plan_id.value,
        billing_period: 'monthly' as const,
      };
    } else if (billing_period.value) {
      payload.plan = {
        plan_id: plan_id.value,
        billing_period: billing_period.value,
      };
    }
  }

  const result = await accountStore.addAccount(payload);

  if (result) {
    isVisible.value = false;

    await accountStore.listAccount();
  }
};

const resetForm = () => {
  name.value = null;
  account_status_id.value = EAccountStatus.active;
  plan_id.value = null;
  billing_period.value = null;
  refFormAddAccount.value?.resetValidation();
};

watch(plan_id, (newValue) => {
  if (!newValue) {
    billing_period.value = null;
  }
});

onMounted(async () => {
  resetForm();
  if (!planStore.listAll.length) {
    await planStore.listPlanAll();
  }
});

watch(isVisible, async (visible) => {
  if (visible) {
    resetForm();
    if (!planStore.listAll.length) {
      await planStore.listPlanAll();
    }
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="accountStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddAccount" @submit.prevent>
      <VCard :title="$t('add_account')">
        <VCardText>
          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                maxlength="10"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="mb-1 text-body-2"
                >{{ $t('account_status') }}:</VLabel
              >
              <VMenu v-model="isStatusMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredStatuses.find(
                        (status) => status.value === account_status_id
                      )?.text || ''
                    "
                    :placeholder="$t('account_status')"
                    variant="outlined"
                    readonly
                    :clearable="!!account_status_id"
                    clear-icon="tabler-x"
                    @click:clear="account_status_id = null"
                    :append-inner-icon="
                      account_status_id ? undefined : 'tabler-chevron-down'
                    "
                  />
                </template>
                <VCard>
                  <VCardText class="pa-2">
                    <AppTextField
                      v-model="statusSearchQuery"
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
                    <template v-if="filteredStatuses.length > 0">
                      <VListItem
                        v-for="(item, index) in filteredStatuses"
                        :key="index"
                        :value="item.value"
                        @click="
                          () => {
                            account_status_id = item.value;
                            isStatusMenuOpen = false;
                            statusSearchQuery = '';
                          }
                        "
                        :active="account_status_id === item.value"
                      >
                        <VListItemTitle>{{ item.text }}</VListItemTitle>
                      </VListItem>
                    </template>
                    <VListItem v-else-if="statusSearchQuery" disabled>
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
                    <VListItem v-else disabled>
                      <VListItemTitle
                        class="text-center text-body-2 text-medium-emphasis"
                      >
                        {{
                          planSearchQuery
                            ? $t('no_results_found')
                            : $t('no_items_available')
                        }}
                      </VListItemTitle>
                    </VListItem>
                  </VList>
                </VCard>
              </VMenu>
            </VCol>
            <VCol v-if="showBillingPeriod" cols="12" md="6">
              <VLabel class="mb-1 text-body-2"
                >{{ $t('billing_period') }}:</VLabel
              >
              <VMenu v-model="isBillingPeriodMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredBillingPeriods.find(
                        (item) => item.value === billing_period
                      )?.text || ''
                    "
                    :placeholder="$t('billing_period')"
                    variant="outlined"
                    readonly
                    :clearable="!!billing_period"
                    clear-icon="tabler-x"
                    @click:clear="billing_period = null"
                    :append-inner-icon="
                      billing_period ? undefined : 'tabler-chevron-down'
                    "
                    :error-messages="
                      !billing_period
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
                            billing_period = item.value as 'monthly' | 'annual';
                            isBillingPeriodMenuOpen = false;
                            billingPeriodSearchQuery = '';
                          }
                        "
                        :active="billing_period === item.value"
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
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addAccount"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
