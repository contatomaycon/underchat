<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { useAbility } from '@/plugins/casl/composables/useAbility';
import AccountTab from './account-settings/account-tab.vue';
import SecurityTab from './account-settings/security-tab.vue';
import PlansTab from './account-settings/plans-tab.vue';
import InvoicesTab from './account-settings/invoices-tab.vue';

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

const tab = ref((route.query.tab as string) || 'account');

watch(tab, (v) => {
  router.replace({ query: { ...route.query, tab: v } });
});

watch(
  () => route.query.tab,
  (newTab) => {
    if (newTab && typeof newTab === 'string') {
      if (
        (newTab === 'plans' || newTab === 'invoices') &&
        !canAccessPlanInvoice.value
      ) {
        router.replace({ query: { ...route.query, tab: 'account' } });
        tab.value = 'account';
      } else {
        tab.value = newTab;
      }
    }
  },
  { immediate: true }
);
</script>

<template>
  <VCard flat>
    <VCardText class="pb-0">
      <VTabs v-model="tab" class="mb-2">
        <VTab value="account" prepend-icon="tabler-user">
          {{ $t('account') }}
        </VTab>
        <VTab value="security" prepend-icon="tabler-lock">
          {{ $t('security') }}
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
    </VCardText>

    <VCardText>
      <VWindow v-model="tab" class="disable-tab-transition">
        <VWindowItem value="account">
          <AccountTab />
        </VWindowItem>
        <VWindowItem value="security">
          <SecurityTab />
        </VWindowItem>
        <VWindowItem v-if="canAccessPlanInvoice" value="plans">
          <PlansTab />
        </VWindowItem>
        <VWindowItem v-if="canAccessPlanInvoice" value="invoices">
          <InvoicesTab />
        </VWindowItem>
      </VWindow>
    </VCardText>
  </VCard>
</template>
