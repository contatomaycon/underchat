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
      <div class="internal-chat-page-shell">
        <InternalChatWorkspace />
      </div>
    </VMain>
  </VLayout>
</template>

<style scoped lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';

.internal-chat-page-layout {
  border-radius: vuetify.$card-border-radius;
  block-size: 100%;
  min-block-size: 100%;
  overflow: hidden;
  @include mixins.elevation(vuetify.$card-elevation);
  $sel-internal-chat-page-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-internal-chat-page-layout);
    }
  }
}

.internal-chat-page-main {
  block-size: 100%;
  min-block-size: 0;
  background: rgb(var(--v-theme-background));
}

.internal-chat-page-shell {
  block-size: 100%;
  min-block-size: 0;
}
</style>
