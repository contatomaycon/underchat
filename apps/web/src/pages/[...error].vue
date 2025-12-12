<script setup lang="ts">
definePage({
  alias: '/pages/misc/not-found/:error(.*)',
});

const router = useRouter();
const goHome = () => {
  router.push({ name: 'root' });
};
</script>

<template>
  <div class="plan-expired-wrapper">
    <VCard
      variant="elevated"
      class="text-center pa-8 account-settings-card plan-expired-card"
    >
      <VCardText class="d-flex flex-column align-center gap-4">
        <VAvatar color="primary" variant="tonal" size="80">
          <VIcon icon="tabler-map-pin-exclamation" size="42" />
        </VAvatar>
        <div>
          <h4 class="text-h5 mb-2">Página não encontrada</h4>
          <p class="text-body-1 text-medium-emphasis mb-0">
            Não encontramos a página solicitada. Volte para o início e continue
            navegando.
          </p>
        </div>
        <VBtn color="primary" variant="flat" @click="goHome">
          Voltar para o início
        </VBtn>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.plan-expired-wrapper {
  min-height: calc(100vh - 120px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.plan-expired-card {
  width: 100%;
  min-height: 70vh;
}
</style>
