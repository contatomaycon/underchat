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
    <AppAccountInfoInline v-if="accountId" :account-id="accountId" />
  </div>
</template>
