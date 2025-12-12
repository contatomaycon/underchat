<script setup lang="ts">
import { ref, onMounted } from 'vue';
import AppAccountInfoInline from '@/components/account/AppAccountInfoInline.vue';
import { getUser } from '@/@webcore/localStorage/user';

const accountId = ref<string | null>(null);

onMounted(() => {
  accountId.value = getUser()?.account_id ?? null;
});
</script>

<template>
  <div class="customize-tab">
    <VCard class="mb-4">
      <VCardText class="d-flex flex-wrap justify-space-between align-center">
        <div>
          <div class="text-h6 mb-1">{{ $t('account_info') }}</div>
          <div class="text-body-2 text-medium-emphasis">
            {{ $t('account_customization_hint') }}
          </div>
        </div>
      </VCardText>
    </VCard>

    <AppAccountInfoInline
      v-if="accountId"
      :account-id="accountId"
    />
  </div>
</template>
