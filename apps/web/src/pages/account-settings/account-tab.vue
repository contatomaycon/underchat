<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div>
    <VCard variant="outlined">
      <VCardText>
        <p class="text-body-1">{{ $t('account_settings_coming_soon') }}</p>
      </VCardText>
    </VCard>
  </div>
</template>
