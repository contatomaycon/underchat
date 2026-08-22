<script setup lang="ts">
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import AppPublicApiTokenCard from '@/components/integration/AppPublicApiTokenCard.vue';
import AppOutboundWebhooksCard from '@/components/integration/AppOutboundWebhooksCard.vue';
import AppWebhookIntegrationsCard from '@/components/integration/AppWebhookIntegrationsCard.vue';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

definePage({
  meta: {
    requiredPlanProducts: [EPlanProduct.integration],
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EIntegrationPermissions.integration_group,
      EIntegrationPermissions.integration_status_update,
      EIntegrationPermissions.integration_generate_key,
    ],
  },
});

const integrationStore = useIntegrationStore();
useSnackbarCleanup(integrationStore);
</script>

<template>
  <main class="integration-page">
    <header class="integration-page__header">
      <div>
        <p class="integration-page__eyebrow">
          {{ $t('integration_page_eyebrow') }}
        </p>
        <h1 class="integration-page__title">
          {{ $t('integration_page_title') }}
        </h1>
        <p class="integration-page__description">
          {{ $t('integration_page_description') }}
        </p>
      </div>
    </header>

    <AppPublicApiTokenCard />
    <AppOutboundWebhooksCard />
    <AppWebhookIntegrationsCard />

    <VSnackbar
      v-model="integrationStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="integrationStore.snackbar.color"
    >
      {{ integrationStore.snackbar.message }}
    </VSnackbar>
  </main>
</template>

<style scoped lang="scss">
.integration-page {
  display: grid;
  gap: 1.25rem;
}

.integration-page__header {
  padding-inline: 0.25rem;
}

.integration-page__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0.1em;
  margin-block: 0 0.3rem;
  margin-inline: 0;
  text-transform: uppercase;
}

.integration-page__title {
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: clamp(1.35rem, 2vw, 1.75rem);
  font-weight: 720;
  letter-spacing: -0.025em;
}

.integration-page__description {
  color: rgb(var(--v-theme-on-surface), 0.62);
  font-size: 0.9rem;
  line-height: 1.55;
  margin-block: 0.4rem 0;
  margin-inline: 0;
  max-inline-size: 54rem;
}
</style>

<route lang="json">
{
  "name": "integration"
}
</route>
