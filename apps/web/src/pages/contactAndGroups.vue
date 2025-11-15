<route lang="json">
{
  "name": "contact-and-groups",
  "meta": { "public": true }
}
</route>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Contact from './contact.vue';
import ContactGroup from './contactGroup.vue';

definePage({
  meta: { permissions: [] },
});

const route = useRoute();
const router = useRouter();
const tab = ref((route.query.tab as string) || 'contacts');
watch(tab, (v) => router.replace({ query: { ...route.query, tab: v } }));
</script>

<template>
  <VCard flat>
    <VCardText class="pb-0">
      <VTabs v-model="tab" class="mb-2">
        <VTab value="contacts" prepend-icon="tabler-address-book">{{
          $t('contacts')
        }}</VTab>
        <VTab value="groups" prepend-icon="tabler-users">{{
          $t('contact_groups')
        }}</VTab>
      </VTabs>
    </VCardText>

    <VCardText>
      <VWindow v-model="tab" class="disable-tab-transition">
        <VWindowItem value="contacts"><Contact /></VWindowItem>
        <VWindowItem value="groups"><ContactGroup /></VWindowItem>
      </VWindow>
    </VCardText>
  </VCard>
</template>
