<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import { EContactGroupPermissions } from '@core/common/enums/EPermissions/contactGroup';
import Contact from './contact.vue';
import ContactGroup from './contact-group.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EContactPermissions.contact_group,
      EContactPermissions.contact_view,
      EContactGroupPermissions.contact_group_assignment_group,
      EContactGroupPermissions.contact_group_view,
    ],
  },
});

const permissionsContactGroup = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EContactGroupPermissions.contact_group_assignment_group,
  EContactGroupPermissions.contact_group_view,
];

const route = useRoute();
const router = useRouter();
const tab = ref((route.query.tab as string) || 'contacts');

watch(tab, (v) => {
  router.replace({ query: { ...route.query, tab: v } });
});
</script>

<template>
  <VCard flat>
    <VCardText class="pb-0">
      <VTabs v-model="tab" class="mb-2">
        <VTab value="contacts" prepend-icon="tabler-address-book">{{
          $t('contacts')
        }}</VTab>
        <VTab
          v-if="$canPermission(permissionsContactGroup)"
          value="groups"
          prepend-icon="tabler-users"
        >{{
          $t('contact_groups')
        }}</VTab>
      </VTabs>
    </VCardText>

    <VCardText>
      <VWindow v-model="tab" class="disable-tab-transition">
        <VWindowItem value="contacts"><Contact /></VWindowItem>
        <VWindowItem
          v-if="$canPermission(permissionsContactGroup)"
          value="groups"
        ><ContactGroup /></VWindowItem>
      </VWindow>
    </VCardText>
  </VCard>
</template>

<route lang="json">
{
  "name": "contact-and-groups",
  "meta": { "public": true }
}
</route>
