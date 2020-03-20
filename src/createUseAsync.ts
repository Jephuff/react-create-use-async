import EventEmitter from "eventemitter3";
import omit from "lodash.omit";
import Queue from "p-queue";
import { useEffect, useState } from "react";

import { Unreachable } from "./UnreachableError";

const useForceRender = () => {
  const [, setState] = useState(0);
  return () => setState(cur => cur + 1);
};

enum Status {
  Pending,
  Resolved,
  Rejected,
}

type AbortablePromise = Promise<void> & { abort: () => boolean; meta: unknown };
interface CacheStatus<
  Args,
  FetchStatus,
  Value,
  Next = AbortablePromise | null
> {
  status: FetchStatus;
  value: Value;
  next: Next;
  args: Args;
}

type Cache<Args, Data> = {
  [args: string]:
    | CacheStatus<Args, Status.Rejected, Error>
    | CacheStatus<Args, Status.Resolved, Data>
    | CacheStatus<Args, Status.Pending, AbortablePromise, null>;
};

interface UseAsync<Args, Data> {
  (args: Args): Data;
  invalidateAll: (onlyRejected?: boolean) => void;
  invalidate: (args: Args) => void;
  preload: (args: Args) => Promise<Data>;
  read: (args: Args) => Data;
  on: (args: Args | "any", callback: () => void) => void;
  off: (args: Args | "any", callback: () => void) => void;
}

export class UseAsyncError extends Error {}
const queue = new Queue({ concurrency: Infinity });

const allUseAsyncs: UseAsync<any, unknown>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

export function invalidateAll(onlyRejected?: boolean) {
  allUseAsyncs.forEach(useAsync => useAsync.invalidateAll(onlyRejected));
}

function getKey(args: { [key: string]: string | number | undefined }) {
  return JSON.stringify(
    Object.entries(omit(args, "priority")).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  );
}

export const createUseAsync = <
  Data,
  Args extends { [key: string]: string | number | undefined; priority?: number }
>(
  fetchData: (args: Args) => Promise<Data>
): UseAsync<Args, Data> => {
  const cache: Cache<Args, Data> = {};
  const emitter = new EventEmitter();

  const startLoading = (args: Args, isRefetch = false) => {
    const key = getKey(args);
    let existingCache = cache[key];
    if (
      existingCache &&
      (existingCache.args.priority || 0) < (args.priority || 0)
    ) {
      if (isRefetch && existingCache.next && existingCache.next.abort()) {
        existingCache.next = null;
      } else if (
        existingCache.status === Status.Pending &&
        existingCache.value.abort()
      ) {
        delete cache[key];
      }
    }

    existingCache = cache[key];
    if (
      !existingCache ||
      (isRefetch && existingCache.status !== Status.Pending)
    ) {
      let aborted = false;
      let started = false;
      const value = Object.assign(
        queue.add(
          async () => {
            if (aborted) return;
            started = true;

            try {
              const data = await fetchData(args);
              if (!cache[key]) return;
              cache[key].status = Status.Resolved;
              cache[key].value = data;
            } catch (err) {
              if (!cache[key]) return;
              cache[key].status = Status.Rejected;
              cache[key].value = new UseAsyncError(err);
            }
            cache[key].next = null;
            emitter.emit(key);
            emitter.emit("any");
          },
          { priority: args.priority }
        ),
        {
          abort: () => {
            if (!started) aborted = true;
            return aborted;
          },
          meta: args,
        }
      );

      if (!existingCache) {
        cache[key] = { args, next: null, status: Status.Pending, value };
      } else if (isRefetch) {
        cache[key] = { ...existingCache, args, next: value };
      }
    }

    return cache[key];
  };

  const useAsync = (args: Args) => {
    const key = getKey(args);
    const forceRender = useForceRender();

    useEffect(() => {
      emitter.on(key, forceRender);
      return () => {
        emitter.off(key, forceRender);
      };
    }, [forceRender, key]);

    return useAsync.read(args);
  };

  useAsync.read = (args: Args): Data => {
    const state = startLoading(args);
    switch (state.status) {
      case Status.Pending:
        throw state.value;
      case Status.Resolved:
        return state.value;
      case Status.Rejected:
        throw state.value;
      default:
        throw new Unreachable(state);
    }
  };

  useAsync.preload = async (args: Args): Promise<Data> => {
    const state = startLoading(args);
    switch (state.status) {
      case Status.Pending:
        await state.value;
        return useAsync.preload(args);
      case Status.Resolved:
        return state.value;
      case Status.Rejected:
        throw state.value;
      default:
        throw new Unreachable(state);
    }
  };

  useAsync.invalidate = (args: Args) => {
    const key = getKey(args);
    if (
      emitter.listenerCount(key) > 0 &&
      cache[key] &&
      cache[key].status !== Status.Pending &&
      !cache[key].next
    ) {
      startLoading(args, true);
    } else {
      delete cache[key];
      emitter.emit(key);
      emitter.emit("any");
    }
  };

  useAsync.invalidateAll = (onlyRejected = false) => {
    Object.values(cache).forEach(({ args, status }) => {
      if (!onlyRejected || status === Status.Rejected) {
        useAsync.invalidate(args);
      }
    });
  };

  useAsync.on = (args: Args | "any", callback: () => void) => {
    emitter.on(args === "any" ? args : getKey(args), callback);
  };

  useAsync.off = (args: Args | "any", callback: () => void) => {
    emitter.off(args === "any" ? args : getKey(args), callback);
  };

  allUseAsyncs.push(useAsync);

  return useAsync;
};
