<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { useAbility } from '@/plugins/casl/composables/useAbility';
import AccountTab from './account-settings/account-tab.vue';
import SecurityTab from './account-settings/security-tab.vue';
import PlansTab from './account-settings/plans-tab.vue';
import InvoicesTab from './account-settings/invoices-tab.vue';
import CustomizeTab from './account-settings/customize-tab.vue';

const route = useRoute();
const router = useRouter();
const ability = useAbility();

const canAccessPlanInvoice = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EPlanPermissions.plan_group,
    EPlanPermissions.plan_invoice,
  ];

  return permissions.some((perm) => ability.can(perm, perm));
});

const canCustomizeAccount = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EAccountPermissions.account_group,
    EAccountPermissions.account_customize,
  ];

  return permissions.some((perm) => ability.can(perm, perm));
});

const resolveTab = (nextTab: string) => {
  if (
    (nextTab === 'plans' || nextTab === 'invoices') &&
    !canAccessPlanInvoice.value
  ) {
    return 'account';
  }

  if (nextTab === 'customize' && !canCustomizeAccount.value) {
    return 'account';
  }

  return nextTab;
};

const tab = ref(resolveTab((route.query.tab as string) || 'account'));

watch(tab, (v) => {
  const nextTab = resolveTab(v);

  if (tab.value !== nextTab) {
    tab.value = nextTab;
    return;
  }

  if (route.query.tab !== nextTab) {
    router.replace({ query: { ...route.query, tab: nextTab } });
  }
});

watch(
  () => route.query.tab,
  (newTab) => {
    if (newTab && typeof newTab === 'string') {
      const allowedTab = resolveTab(newTab);

      if (route.query.tab !== allowedTab) {
        router.replace({ query: { ...route.query, tab: allowedTab } });
      }

      if (tab.value !== allowedTab) {
        tab.value = allowedTab;
      }
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="account-settings-page">
    <div class="mb-6">
      <VTabs v-model="tab">
      <VTab value="account" prepend-icon="tabler-user">
        {{ $t('account') }}
      </VTab>
      <VTab value="security" prepend-icon="tabler-lock">
        {{ $t('security') }}
      </VTab>
      <VTab
        v-if="canCustomizeAccount"
        value="customize"
        prepend-icon="tabler-brush"
      >
        {{ $t('customize') }}
      </VTab>
      <VTab
        v-if="canAccessPlanInvoice"
        value="plans"
        prepend-icon="tabler-package"
      >
          {{ $t('plans') }}
        </VTab>
        <VTab
          v-if="canAccessPlanInvoice"
          value="invoices"
          prepend-icon="tabler-receipt-2"
        >
          {{ $t('invoices') }}
        </VTab>
      </VTabs>
    </div>

    <VWindow v-model="tab" class="disable-tab-transition">
      <VWindowItem value="account">
        <AccountTab />
      </VWindowItem>
      <VWindowItem value="security">
        <SecurityTab />
      </VWindowItem>
      <VWindowItem v-if="canCustomizeAccount" value="customize">
        <CustomizeTab />
      </VWindowItem>
      <VWindowItem v-if="canAccessPlanInvoice" value="plans">
        <PlansTab />
      </VWindowItem>
      <VWindowItem v-if="canAccessPlanInvoice" value="invoices">
        <InvoicesTab />
      </VWindowItem>
    </VWindow>
  </div>
</template>
