<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useAccountStore } from '@/@webcore/stores/account';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import {
  EditAccountParamsRequest,
  UpdateAccountRequest,
} from '@core/schema/account/editAccount/request.schema';

const accountStore = useAccountStore();

const { t } = useI18n();

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
const name = ref<string | null>(null);
const accountStatus = ref<string | null>(null);
const accountStatusOptions = Object.entries(EAccountStatus).map(
  ([key, value]) => ({
    name: t(`${key}`) || key,
    id: value,
  })
);

const refFormEditAccount = ref<VForm>();

const updateAccount = async () => {
  const validateForm = await refFormEditAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!accountId.value || !name.value || !accountStatus.value) {
    return;
  }

  const payload: EditAccountParamsRequest = {
    account_id: accountId.value,
  };

  const body: UpdateAccountRequest = {
    name: name.value,
    account_status: {
      account_status_id: accountStatus.value,
    },
  };

  const result = await accountStore.updateAccount(payload, body);

  if (result) {
    isVisible.value = false;

    await accountStore.listAccount();
  }
};

onMounted(async () => {
  if (!accountId.value) return;

  const account = await accountStore.getAccountById(accountId.value);
  if (account) {
    name.value = account.name;
    accountStatus.value = account.account_status?.account_status_id ?? null;
  }
});
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

    <VForm ref="refFormEditAccount" @submit.prevent>
      <VCard :title="$t('edit_account')">
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
              <AppSelect
                v-model="accountStatus"
                :items="accountStatusOptions"
                item-title="name"
                item-value="id"
                :label="$t('account_status') + ':'"
                :placeholder="$t('account_status')"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateAccount"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
