<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/@webcore/stores/auth';
import { useAccountStore } from '@/@webcore/stores/account';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { can } from '@/@layouts/plugins/casl';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';
import { applyLayoutTheme } from '@/@webcore/utils/applyLayoutTheme';
import { useConfigStore } from '@webcore/stores/config';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { useTheme } from 'vuetify';
import { resetConnection } from '@/@webcore/centrifugo';
import { resetPresencePermissionError } from '@/@webcore/presence';
import { useChatStore } from '@/@webcore/stores/chat';
import { nextTick } from 'vue';

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const accountStore = useAccountStore();
const configStore = useConfigStore();
const layoutStore = useLayoutConfigStore();
const vuetifyTheme = useTheme();
const chatStore = useChatStore();

const isModalOpen = ref(false);
const selectedAccountId = ref<string | null>(null);
const accounts = ref<IAccountBasic[]>([]);
const loading = ref(false);
const switching = ref(false);

const hasFullAccess = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const currentAccountId = computed(() => authStore.user?.account_id);

const openModal = async () => {
  if (!hasFullAccess.value) return;

  isModalOpen.value = true;
  selectedAccountId.value = null;

  if (accounts.value.length === 0) {
    loading.value = true;
    const fetchedAccounts = await accountStore.listMasterAccessibleAccounts();
    accounts.value = fetchedAccounts.filter(
      (acc) => acc.account_id !== currentAccountId.value
    );
    loading.value = false;
  }
};

const closeModal = () => {
  isModalOpen.value = false;
  selectedAccountId.value = null;
};

const handleSwitchAccount = async () => {
  if (!selectedAccountId.value) return;

  switching.value = true;

  try {
    const success = await authStore.masterSessionLogin(selectedAccountId.value);

    if (success) {
      try {
        applyLayoutTheme(authStore.layout, {
          configStore,
          layoutStore,
          vuetifyTheme,
        });
      } catch (error) {
        console.error('Failed to apply layout/theme after login', error);
      }

      resetConnection();
      resetPresencePermissionError();

      chatStore.updateUser();
      const permissions = authStore.permissions;

      const userAbilityRules = permissions.map((permission) => ({
        action: permission,
        subject: permission,
      }));

      try {
        const { ability: abilityInstance } =
          await import('@/plugins/casl/ability');
        abilityInstance.update(userAbilityRules);
      } catch (error) {
        console.error('Failed to update permissions after login', error);
      }

      await nextTick();
      closeModal();

      setTimeout(() => {
        window.location.reload();
      }, 100);
    }
  } catch (error) {
    console.error('Error switching account', error);
  } finally {
    switching.value = false;
  }
};

watch(isModalOpen, (newValue) => {
  if (!newValue) {
    accounts.value = [];
    selectedAccountId.value = null;
  }
});
</script>

<template>
  <IconBtn
    v-if="hasFullAccess"
    class="me-2"
    @click="openModal"
    :title="t('switch_account')"
  >
    <VIcon icon="tabler-switch-horizontal" />
  </IconBtn>

  <VDialog v-model="isModalOpen" max-width="500" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ t('switch_account') }}</span>
        <IconBtn @click="closeModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText>
        <VSelect
          v-model="selectedAccountId"
          :items="accounts"
          item-title="name"
          item-value="account_id"
          :label="t('select_account')"
          :loading="loading"
          :disabled="switching"
          variant="outlined"
          density="comfortable"
        />
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="switching"
          @click="closeModal"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :disabled="!selectedAccountId || switching"
          :loading="switching"
          @click="handleSwitchAccount"
        >
          {{ t('enter') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
