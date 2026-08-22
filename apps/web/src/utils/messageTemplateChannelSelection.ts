export const reconcileMessageTemplateChannelIds = (
  selectedChannelIds: readonly string[] | null | undefined,
  availableChannelIds: readonly string[]
): string[] => {
  const availableIds = new Set(availableChannelIds);

  return [...new Set(selectedChannelIds ?? [])].filter((channelId) =>
    availableIds.has(channelId)
  );
};
