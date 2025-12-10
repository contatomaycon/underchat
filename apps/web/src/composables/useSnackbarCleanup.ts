import { onUnmounted } from 'vue';

export function useSnackbarCleanup(store: { hideSnackbar?: () => void }) {
  onUnmounted(() => {
    if (store.hideSnackbar) {
      store.hideSnackbar();
    }
  });
}
