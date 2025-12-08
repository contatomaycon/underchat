<script lang="ts" setup>
import { useCrossSellStore } from '@/@webcore/stores/crossSell';
import { useAccountStore } from '@/@webcore/stores/account';
import { VForm } from 'vuetify/components/VForm';
import { EColor } from '@core/common/enums/EColor';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';
import { ListCrossSellAccountResponse } from '@core/schema/planCrossSell/listCrossSellAccount/response.schema';

const crossSellStore = useCrossSellStore();
const accountStore = useAccountStore();
const { t, locale } = useI18n();

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

const getCurrencyConfig = () => {
  const localeMap: Record<string, { locale: string; currency: string }> = {
    pt: { locale: 'pt-BR', currency: 'BRL' },
    en: { locale: 'en-US', currency: 'USD' },
    es: { locale: 'es-ES', currency: 'EUR' },
  };

  return localeMap[locale.value] || localeMap.pt;
};

const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const config = getCurrencyConfig();
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
  }).format(value);
};

const getCrossSellData = computed(() => {
  if (!crossSellId.value) return null;
  const crossSell = crossSellStore.list.find(
    (cs) => cs.plan_cross_sell_id === crossSellId.value
  );
  if (!crossSell) return null;
  return {
    name: crossSell.plan_product?.name || t('unknown_product'),
    description: crossSell.plan_product?.description || null,
    quantity: crossSell.quantity,
    price: crossSell.price,
  };
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

    <VOverlay
      :model-value="crossSellStore.loading || accountStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="$t('link_account')">
      <VCardText>
        <VAlert
          v-if="getCrossSellData"
          type="info"
          variant="tonal"
          class="mb-4"
        >
          <div class="d-flex flex-column">
            <div class="d-flex align-center mb-2">
              <VIcon icon="tabler-info-circle" class="me-2" />
              <span class="text-body-1 font-weight-medium">
                {{ $t('linking_account_to_product') }}
              </span>
            </div>
            <div class="ms-8">
              <div class="d-flex flex-column gap-1 mb-1">
                <div class="d-flex align-center flex-wrap gap-2">
                  <VIcon icon="tabler-package" size="18" class="text-primary" />
                  <span class="text-body-2">
                    <strong>{{ $t('product') }}:</strong>
                    {{ getCrossSellData.name }}
                  </span>
                </div>
                <div
                  v-if="getCrossSellData.description"
                  class="text-body-2 text-medium-emphasis ms-6"
                >
                  {{ getCrossSellData.description }}
                </div>
              </div>
              <div class="d-flex align-center flex-wrap gap-2 mb-1">
                <VIcon icon="tabler-hash" size="18" class="text-primary" />
                <span class="text-body-2">
                  <strong>{{ $t('quantity') }}:</strong>
                  {{ getCrossSellData.quantity }}
                </span>
              </div>
              <div class="d-flex align-center flex-wrap gap-2">
                <VIcon
                  icon="tabler-currency-dollar"
                  size="18"
                  class="text-primary"
                />
                <span class="text-body-2">
                  <strong>{{ $t('price') }}:</strong>
                  {{ formatCurrency(getCrossSellData.price) }}
                </span>
              </div>
            </div>
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
              <AppSelectSearch
                v-model="account_id"
                :items="accountsOptions"
                :label="$t('account')"
                :placeholder="$t('select_account')"
                :clearable="true"
                item-value="value"
                item-title="title"
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
