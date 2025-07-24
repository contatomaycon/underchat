import { stringifyQuery } from 'ufo';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

interface Options {
  query: MaybeRefOrGetter<Record<string, any>>;
}

export const createUrl = (url: MaybeRefOrGetter<string>, options?: Options) =>
  computed(() => {
    const u = toValue(url);
    if (!options?.query) return u;

    const qObj = Object.fromEntries(
      Object.entries(toValue(options.query)).map(([k, v]) => [k, toValue(v)])
    );

    const qs = stringifyQuery(qObj);

    return qs ? u + '?' + qs : u;
  });
