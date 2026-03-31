import { type RefObject, useCallback, useSyncExternalStore } from "react";

export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const subscribe = useCallback(
    (callback: () => void) => {
      const el = ref.current;
      if (!el) return () => {};

      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", callback);
        return () => window.removeEventListener("resize", callback);
      }

      const observer = new ResizeObserver(callback);
      observer.observe(el);
      return () => observer.disconnect();
    },
    [ref],
  );

  const getSnapshot = useCallback(() => {
    return ref.current?.clientWidth ?? 0;
  }, [ref]);

  const getServerSnapshot = useCallback(() => 0, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
