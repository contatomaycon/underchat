interface ISelectServiceApiConsumerStartersInput<
  TBuildStarter,
  TNonBuildStarter,
> {
  enableBuildConsumers: boolean;
  enableNonBuildConsumers: boolean;
  buildConsumerStarters: readonly TBuildStarter[];
  nonBuildConsumerStarters: readonly TNonBuildStarter[];
}

export function selectServiceApiConsumerStarters<
  TBuildStarter,
  TNonBuildStarter,
>(
  input: ISelectServiceApiConsumerStartersInput<TBuildStarter, TNonBuildStarter>
): Array<TBuildStarter | TNonBuildStarter> {
  const starters: Array<TBuildStarter | TNonBuildStarter> = [];

  if (input.enableNonBuildConsumers) {
    starters.push(...input.nonBuildConsumerStarters);
  }

  if (input.enableBuildConsumers) {
    starters.push(...input.buildConsumerStarters);
  }

  return starters;
}
