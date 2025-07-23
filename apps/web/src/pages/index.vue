<script setup lang="ts">
import { EGeneralPermissions } from '@main/common/enums/EPermissions/general';
import { EHomePermissions } from '@main/common/enums/EPermissions/home';

definePage({
  meta: {
    permissions: [EGeneralPermissions.full_access, EHomePermissions.home_view],
  },
});
</script>

<template>
  <div>
    <VCard class="mb-6" title="Kick start your project 🚀">
      <VCardText>All the best for your new project.</VCardText>
      <VCardText>
        Please make sure to read our
        <a
          href="https://demos.pixinvent.com/vuexy-vuejs-admin-template/documentation/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-decoration-none"
        >
          Template Documentation
        </a>
        to understand where to go from here and how to use our template.
      </VCardText>
    </VCard>

    <VCard title="Want to integrate JWT? 🔒">
      <VCardText
        >We carefully crafted JWT flow so you can implement JWT with ease and
        with minimum efforts.</VCardText
      >
      <VCardText
        >Please read our JWT Documentation to get more out of JWT
        authentication.</VCardText
      >
    </VCard>
  </div>
</template>
