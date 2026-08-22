<template>
  <div class="account-tab-skeleton">
    <div class="account-tab-skeleton__profile">
      <VSkeletonLoader
        class="account-tab-skeleton__avatar"
        type="avatar"
        width="128"
        height="128"
      />
      <VSkeletonLoader type="text" width="160" height="24" />
      <VSkeletonLoader type="text" width="230" height="18" />
      <VSkeletonLoader type="button" width="180" height="40" />
      <VSkeletonLoader type="button" width="120" height="40" />
    </div>

    <div class="account-tab-skeleton__content">
      <AccountSettingsSection title=" " icon="tabler-id">
        <VRow class="account-tab-skeleton__grid">
          <VCol v-for="field in 7" :key="field" cols="12" md="6">
            <VSkeletonLoader type="text" width="96" height="18" class="mb-1" />
            <VSkeletonLoader type="text" height="44" />
          </VCol>
        </VRow>

        <template #actions>
          <VSkeletonLoader type="button" width="112" height="40" />
        </template>
      </AccountSettingsSection>

      <AccountSettingsSection title=" " icon="tabler-map-pin">
        <VRow class="account-tab-skeleton__grid">
          <VCol v-for="field in 7" :key="field" cols="12" md="6">
            <VSkeletonLoader type="text" width="96" height="18" class="mb-1" />
            <VSkeletonLoader type="text" height="44" />
          </VCol>
        </VRow>

        <template #actions>
          <VSkeletonLoader type="button" width="112" height="40" />
        </template>
      </AccountSettingsSection>
    </div>
  </div>
</template>

<style scoped lang="scss">
.account-tab-skeleton {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 24px;
}

.account-tab-skeleton__profile {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 14px;
  padding: 24px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 16px 42px -28px rgb(var(--v-theme-shadow-color) / 0.5);
}

.account-tab-skeleton__avatar {
  overflow: hidden;
  border-radius: 50%;
}

.account-tab-skeleton__content {
  display: grid;
  gap: 18px;
}

.account-tab-skeleton__grid {
  margin: -6px -8px;
}

.account-tab-skeleton__grid :deep(.v-col) {
  padding: 6px 8px;
}

@media (max-width: 1279px) {
  .account-tab-skeleton {
    grid-template-columns: 1fr;
  }
}
</style>
