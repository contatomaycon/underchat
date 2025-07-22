<script setup lang="ts">
interface Props {
  isDialogVisible: boolean;
}

type Emit = (e: 'update:isDialogVisible', val: boolean) => void;

const props = defineProps<Props>();
const emit = defineEmits<Emit>();

const dialogVisibleUpdate = (val: boolean) => {
  emit('update:isDialogVisible', val);
};
</script>

<template>
  <VDialog
    :model-value="props.isDialogVisible"
    :width="$vuetify.display.smAndDown ? 'auto' : 1200"
    @update:model-value="dialogVisibleUpdate"
  >
    <DialogCloseBtn @click="$emit('update:isDialogVisible', false)" />

    <VCard class="pricing-dialog pa-2 pa-sm-10">
      <VCardText>
        <AppPricing md="4" />
      </VCardText>
    </VCard>
  </VDialog>
</template>
