<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div>
    <VCard variant="elevated" class="account-settings-card">
      <VCardText>
        <p class="text-body-1">{{ $t('invoices_settings_coming_soon') }}</p>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.account-settings-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px;
}
</style>
