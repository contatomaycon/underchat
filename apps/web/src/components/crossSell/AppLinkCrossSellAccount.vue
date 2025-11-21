<script lang="ts" setup>
import { useCrossSellStore } from '@/@webcore/stores/crossSell';
import { useAccountStore } from '@/@webcore/stores/account';
import { VForm } from 'vuetify/components/VForm';
import { EColor } from '@core/common/enums/EColor';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';
import { ListCrossSellAccountResponse } from '@core/schema/planCrossSell/listCrossSellAccount/response.schema';

const crossSellStore = useCrossSellStore();
const accountStore = useAccountStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  crossSellId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const crossSellId = toRef(props, 'crossSellId');

const account_id = ref<string | null>(null);
const accountsOptions = ref<{ value: string; title: string }[]>([]);

const crossSellAccounts = ref<ListCrossSellAccountResponse[]>([]);

const isDialogDeleteAccountShow = ref(false);
const accountToDelete = ref<string | null>(null);

const refFormLinkAccount = ref<VForm>();

const loadCrossSellAccounts = async () => {
  if (!crossSellId.value) {
    crossSellAccounts.value = [];
    return;
  }

  try {
    const accounts = await crossSellStore.listCrossSellAccount(
      crossSellId.value
    );
    crossSellAccounts.value =
      accounts && Array.isArray(accounts) ? accounts : [];
  } catch (error) {
    console.error('Error loading cross-sell accounts:', error);
    crossSellAccounts.value = [];
  }
};

const linkAccount = async () => {
  const validateForm = await refFormLinkAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!crossSellId.value || !account_id.value) {
    return;
  }

  const existingAccount = crossSellAccounts.value.find(
    (acc) => acc.account_id === account_id.value
  );

  if (existingAccount) {
    crossSellStore.showSnackbar(t('account_already_linked'), EColor.warning);
    return;
  }

  const payload: CreateCrossSellAccountRequest = {
    plan_cross_sell_id: crossSellId.value,
    account_id: account_id.value,
  };

  const result = await crossSellStore.createCrossSellAccount(payload);
  if (result) {
    await loadCrossSellAccounts();
    resetForm();
  }
};

const openDeleteAccountDialog = (accountId: string) => {
  accountToDelete.value = accountId;
  isDialogDeleteAccountShow.value = true;
};

const handleRemoveCrossSellAccount = async () => {
  if (!accountToDelete.value) return;

  const result = await crossSellStore.deleteCrossSellAccount(
    accountToDelete.value
  );
  if (result) {
    await loadCrossSellAccounts();
  }

  accountToDelete.value = null;
};

const resetForm = () => {
  account_id.value = null;
  refFormLinkAccount.value?.resetValidation();
};

const getAccountName = (item: ListCrossSellAccountResponse) => {
  return item.account?.name || t('unknown_account');
};

const getCrossSellProductName = computed(() => {
  if (!crossSellId.value) return '';
  const crossSell = crossSellStore.list.find(
    (cs) => cs.plan_cross_sell_id === crossSellId.value
  );
  return crossSell?.plan_product?.name || t('unknown_product');
});

const loadAccounts = async () => {
  const accounts = await accountStore.listAllAccounts();
  if (accounts) {
    accountsOptions.value = accounts.map((acc) => ({
      value: acc.account_id,
      title: acc.name,
    }));
  }
};

watch(
  [isVisible, crossSellId],
  async ([visible, newCrossSellId]) => {
    if (visible && newCrossSellId) {
      resetForm();
      if (crossSellStore.list.length === 0) {
        await crossSellStore.listCrossSell();
      }
      await loadCrossSellAccounts();
      await loadAccounts();
    } else if (!visible) {
      crossSellAccounts.value = [];
    }
  },
  { immediate: true }
);

onMounted(async () => {
  resetForm();
  await loadAccounts();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="800">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="crossSellStore.loading || accountStore.loading">
      <VOverlay
        :model-value="crossSellStore.loading || accountStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard :title="$t('link_account')">
      <VCardText>
        <VAlert
          v-if="getCrossSellProductName"
          type="info"
          variant="tonal"
          class="mb-4"
        >
          <div class="d-flex align-center">
            <VIcon icon="tabler-info-circle" class="me-2" />
            <span>
              {{ $t('linking_account_to_product') }}:
              <strong>{{ getCrossSellProductName }}</strong>
            </span>
          </div>
        </VAlert>

        <div v-if="crossSellAccounts.length > 0" class="mb-6">
          <VLabel class="mb-3">{{ $t('linked_accounts_list') }}</VLabel>
          <VList>
            <VListItem
              v-for="account in crossSellAccounts"
              :key="account.plan_cross_sell_account_id"
              class="border rounded mb-2"
            >
              <VListItemTitle>
                <div class="d-flex justify-space-between align-center">
                  <div>
                    <strong>{{ getAccountName(account) }}</strong>
                  </div>
                  <IconBtn
                    color="error"
                    variant="text"
                    @click="
                      openDeleteAccountDialog(
                        account.plan_cross_sell_account_id
                      )
                    "
                  >
                    <VTooltip
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{ $t('remove') }}</span>
                    </VTooltip>
                    <VIcon icon="tabler-trash" />
                  </IconBtn>
                </div>
              </VListItemTitle>
            </VListItem>
          </VList>
        </div>

        <VDivider v-if="crossSellAccounts.length > 0" class="my-4" />

        <VForm ref="refFormLinkAccount" @submit.prevent>
          <VLabel class="mb-3">{{ $t('add_new_account') }}</VLabel>
          <VRow>
            <VCol cols="12">
              <AppAutocomplete
                v-model="account_id"
                :items="accountsOptions"
                :label="$t('account') + ':'"
                :placeholder="$t('select_account')"
                :rules="[requiredValidator(account_id, $t('account_required'))]"
              />
            </VCol>
          </VRow>
        </VForm>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
        <VBtn @click="linkAccount"> {{ $t('add') }} </VBtn>
      </VCardText>
    </VCard>

    <VDialogHandler
      v-if="isDialogDeleteAccountShow"
      v-model="isDialogDeleteAccountShow"
      :title="$t('remove_cross_sell_account')"
      :message="$t('remove_cross_sell_account_confirmation')"
      @confirm="handleRemoveCrossSellAccount"
    />
  </VDialog>
</template>

<style lang="scss" scoped>
.border {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
