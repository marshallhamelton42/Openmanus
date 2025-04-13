import { AuthAction, AuthWrapper } from '@/lib/auth-wrapper';
import { DependencyList, useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

type CacheStore = {
  caches: Map<boolean | string | Symbol, any>;
  getCache: <R>(cacheKey: boolean | string | Symbol) => R | undefined;
  setCache: <R>(cacheKey: boolean | string | Symbol, data: R) => void;
};

const useCacheStore = create<CacheStore>((set, get) => ({
  caches: new Map(),
  getCache: cacheKey => {
    const { caches } = get();
    return caches.get(cacheKey) || undefined;
  },
  setCache: (cacheKey, data) => {
    set(state => {
      const newCaches = new Map(state.caches);
      newCaches.set(cacheKey, data);
      return { caches: newCaches };
    });
  },
}));

export const useAsync = <R, T extends unknown[]>(
  fn: (...params: T) => Promise<R>,
  params: T,
  options: { manual?: boolean; deps?: DependencyList; skip?: (params: T) => boolean; cache?: string | Symbol } = {},
) => {
  const [data, setData] = useState<R | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const fnRef = useRef(fn);
  const { getCache, setCache } = useCacheStore();

  const cacheKey = options.cache || false;

  useEffect(() => {
    if (options.cache && !options.manual) {
      const cachedData = getCache<R>(cacheKey);
      if (cachedData !== undefined) {
        setData(cachedData);
      }
    }
  }, [cacheKey, options.cache, options.manual]);

  // Update function reference without triggering re-renders
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const shouldSkip = options.skip ? options.skip(params) : false;
  const run = useCallback(
    async (...runParams: T) => {
      if (shouldSkip) {
        return;
      }

      setIsLoading(true);
      try {
        const result = await fnRef.current(...runParams);
        setData(result);

        if (options.cache) {
          setCache<R>(cacheKey, result);
        }

        return result;
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [shouldSkip, cacheKey, options.cache, ...(options.deps ?? [])],
  );

  const refresh = useCallback(() => {
    return run(...params);
  }, [run, ...params]);

  const mutate = useCallback(
    (dataAction: R | undefined | ((prev: R | undefined) => R)) => {
      const newData = typeof dataAction === 'function' ? (dataAction as (prev: R | undefined) => R)(data) : dataAction;
      setData(newData);
      setError(undefined);

      if (options.cache && newData !== undefined) {
        setCache<R>(cacheKey, newData);
      }

      return newData;
    },
    [data, cacheKey, options.cache],
  );

  useEffect(() => {
    if (options.manual) {
      return;
    }

    if (options.cache) {
      const cachedData = getCache<R>(cacheKey);
      if (cachedData !== undefined) {
        setData(cachedData);
        return;
      }
    }
    run(...params);
  }, [run, options.manual, options.cache, cacheKey, ...params]);

  return { data, isLoading, error, run, refresh, mutate };
};

export const useServerAction = <R, T>(fn: AuthAction<T, R>, params: T, options: Parameters<typeof useAsync>[2] = {}) => {
  const res = useAsync((...params: [T]) => fn(params[0]).then(data => data.data), [params], options);

  return {
    data: res.data,
    isLoading: res.isLoading,
    error: res.error,
    run: res.run,
    refresh: res.refresh,
    mutate: res.mutate,
  };
};
