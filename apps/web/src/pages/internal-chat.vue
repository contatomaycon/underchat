<script setup lang="ts">
import InternalChatWorkspace from '@/components/chat/internal/InternalChatWorkspace.vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EInternalChatPermissions } from '@core/common/enums/EPermissions/internalChat';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    requiredPlanProducts: [EPlanProduct.internal_chat],
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EInternalChatPermissions.internal_chat_group,
      EInternalChatPermissions.internal_chat_access,
    ],
  },
});
</script>

<template>
  <VLayout class="internal-chat-page-layout" style="z-index: 0">
    <VMain class="internal-chat-page-main">
      <InternalChatWorkspace />
    </VMain>
  </VLayout>
</template>

<style scoped>
.internal-chat-page-layout,
.internal-chat-page-main {
  block-size: 100%;
}
</style>
