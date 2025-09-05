<script lang="ts" setup>
import { useAccountStore } from '@/@webcore/stores/account';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { EPlan } from '@core/common/enums/EPlan';

const accountStore = useAccountStore();
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

const itemsPlan = ref([
  { value: EPlan.Diamante, text: t('diamante') },
  { value: EPlan.Ouro, text: t('ouro') },
  { value: EPlan.Bronze, text: t('bronze') },
]);

const name = ref<string | null>(null);
const account_status_id = ref<string | null>(null);
const plan_id = ref<string | null>(null);

const refFormAddAccount = ref<VForm>();

const addAccount = async () => {
  const validateForm = await refFormAddAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value || !account_status_id.value || !plan_id.value) {
    return;
  }

  const payload: CreateAccountRequest = {
    name: name.value,
    account_status: {
      account_status_id: account_status_id.value,
    },
    plan: {
      plan_id: plan_id.value,
    },
  };

  const result = await accountStore.addAccount(payload);

  if (result) {
    isVisible.value = false;

    await accountStore.listAccount();
  }
};

const resetForm = () => {
  name.value = null;
  account_status_id.value = null;
  plan_id.value = null;
  refFormAddAccount.value?.resetValidation();
};

watch(isVisible, (visible) => {
  if (visible) resetForm();
});

onMounted(resetForm);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="accountStore.loading">
      <VOverlay
        :model-value="accountStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddAccount" @submit.prevent>
      <VCard :title="$t('add_account')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <AppSelect
                v-model="account_status_id"
                :items="itemsStatus"
                item-title="text"
                item-value="value"
                :label="$t('account_status') + ':'"
                :placeholder="$t('account_status')"
              />
            </VCol>
            <VCol cols="12" md="6">
              <AppSelect
                v-model="plan_id"
                :items="itemsPlan"
                item-title="text"
                item-value="value"
                :label="$t('plan') + ':'"
                :placeholder="$t('plan')"
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
