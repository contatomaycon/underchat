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
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                maxlength="10"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('account_status') }}:</VLabel
              >
              <AppSelectSearch
                v-model="account_status_id"
                :items="itemsStatus"
                :placeholder="$t('account_status')"
                :clearable="true"
                item-value="value"
                item-title="text"
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('plan') }}:</VLabel>
              <AppSelectSearch
                v-model="plan_id"
                :items="itemsPlan"
                :placeholder="$t('plan')"
                :clearable="true"
                item-value="value"
                item-title="text"
              />
            </VCol>
            <VCol v-if="showBillingPeriod" cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('billing_period') }}:</VLabel
              >
              <AppSelectSearch
                v-model="billing_period"
                :items="itemsBillingPeriod"
                :placeholder="$t('billing_period')"
                :clearable="true"
                item-value="value"
                item-title="text"
              />
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
