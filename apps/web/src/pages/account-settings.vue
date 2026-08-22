<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { useAbility } from '@/plugins/0.casl/composables/useAbility';
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

const accountSettingsTabs = computed(() =>
  [
    {
      value: 'account',
      icon: 'tabler-user',
      labelKey: 'account',
      visible: true,
    },
    {
      value: 'security',
      icon: 'tabler-lock',
      labelKey: 'security',
      visible: true,
    },
    {
      value: 'customize',
      icon: 'tabler-palette',
      labelKey: 'customize',
      visible: canCustomizeAccount.value,
    },
    {
      value: 'plans',
      icon: 'tabler-package',
      labelKey: 'plans',
      visible: canAccessPlanInvoice.value,
    },
    {
      value: 'invoices',
      icon: 'tabler-receipt-2',
      labelKey: 'invoices',
      visible: canAccessPlanInvoice.value,
    },
  ].filter((item) => item.visible)
);

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

const setTab = (nextTab: string) => {
  tab.value = nextTab;
};

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
    <nav class="account-settings-nav" :aria-label="$t('settings')">
      <div class="account-settings-tabs" role="tablist">
        <button
          v-for="item in accountSettingsTabs"
          :key="item.value"
          class="account-settings-tab"
          :class="{ 'account-settings-tab--active': tab === item.value }"
          type="button"
          role="tab"
          :aria-selected="tab === item.value"
          @click="setTab(item.value)"
        >
          <span class="account-settings-tab__icon">
            <VIcon :icon="item.icon" size="18" />
          </span>
          <span class="account-settings-tab__label">
            {{ $t(item.labelKey) }}
          </span>
        </button>
      </div>
    </nav>

    <VWindow
      v-model="tab"
      class="disable-tab-transition account-settings-content"
    >
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

<style scoped lang="scss">
.account-settings-page {
  display: grid;
  gap: 24px;
}

.account-settings-nav {
  max-width: 100%;
  overflow-x: auto;
  padding-block-end: 2px;
  scrollbar-width: none;
}

.account-settings-nav::-webkit-scrollbar {
  display: none;
}

.account-settings-tabs {
  display: inline-flex;
  min-width: max-content;
  gap: 8px;
  padding: 4px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.045);
}

.account-settings-content {
  min-width: 0;
}

.account-settings-tab {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  cursor: pointer;
  font-size: 0.925rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;
}

.account-settings-tab__icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: currentColor;
  transition:
    background 0.18s ease,
    color 0.18s ease;
}

.account-settings-tab__label {
  white-space: nowrap;
}

.account-settings-tab:hover {
  background: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
}

.account-settings-tab--active {
  border-color: rgb(var(--v-theme-primary) / 0.28);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 12px 28px -22px rgb(var(--v-theme-primary) / 0.9);
  color: rgb(var(--v-theme-primary));
}

.account-settings-tab--active .account-settings-tab__icon {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

@media (max-width: 599px) {
  .account-settings-page {
    gap: 18px;
  }

  .account-settings-tabs {
    gap: 6px;
    padding: 3px;
  }

  .account-settings-tab {
    min-height: 40px;
    padding: 5px 12px 5px 6px;
    font-size: 0.875rem;
  }

  .account-settings-tab__icon {
    width: 28px;
    height: 28px;
    flex-basis: 28px;
  }
}
</style>
