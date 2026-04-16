<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import NotificationsTab from './config/notifications-tab.vue';
import NfseTab from './config/nfse-tab.vue';
import ChannelsTab from './config/channels-tab.vue';
import CreditCardTab from './config/creditcard-tab.vue';
import S3BackupTab from './config/s3-backup-tab.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
    ],
  },
});

const route = useRoute();
const router = useRouter();
const tab = ref((route.query.tab as string) || 'notifications');

watch(tab, (v) => {
  router.replace({ query: { ...route.query, tab: v } });
});
</script>

<template>
  <VCard flat>
    <VCardText class="pb-0">
      <VTabs v-model="tab" class="mb-2">
        <VTab value="notifications" prepend-icon="tabler-bell">{{
          $t('notifications')
        }}</VTab>
        <VTab value="nfse" prepend-icon="tabler-file-invoice">{{
          $t('nfse')
        }}</VTab>
        <VTab value="creditcard" prepend-icon="tabler-credit-card">{{
          $t('payments')
        }}</VTab>
        <VTab value="s3-backup" prepend-icon="tabler-cloud-up">{{
          $t('s3_backup_tab')
        }}</VTab>
        <VTab value="channels" prepend-icon="tabler-message">{{
          $t('channels')
        }}</VTab>
      </VTabs>
    </VCardText>

    <VCardText>
      <VWindow v-model="tab" class="disable-tab-transition">
        <VWindowItem value="notifications">
          <NotificationsTab />
        </VWindowItem>
        <VWindowItem value="nfse">
          <NfseTab />
        </VWindowItem>
        <VWindowItem value="creditcard">
          <CreditCardTab />
        </VWindowItem>
        <VWindowItem value="s3-backup">
          <S3BackupTab />
        </VWindowItem>
        <VWindowItem value="channels">
          <ChannelsTab />
        </VWindowItem>
      </VWindow>
    </VCardText>
  </VCard>
</template>

<route lang="json">
{
  "name": "config"
}
</route>
