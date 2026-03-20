import { useEffect, useRef, type RefObject } from "react";

/**
 * Staggered reveal animation for child elements.
 * Wraps AnimeJS with dynamic import to stay SSR-safe.
 */
export function useStaggerReveal<T extends HTMLElement>(
  deps: unknown[] = [],
  options?: { delay?: number; stagger?: number; duration?: number; translateY?: number },
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const { delay = 50, stagger = 60, duration = 500, translateY = 18 } = options ?? {};

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const children = el.children;
    if (children.length === 0) return;

    // Set initial state immediately (no flash)
    for (let i = 0; i < children.length; i++) {
      (children[i] as HTMLElement).style.opacity = "0";
      (children[i] as HTMLElement).style.transform = `translateY(${translateY}px)`;
    }

    let cancelled = false;
    (async () => {
      // Dynamic import with cancelled flag handles unmount-during-import race condition
      const { animate, stagger: stg } = await import("animejs");
      if (cancelled) return;
      animate(children, {
        opacity: [0, 1],
        translateY: [translateY, 0],
        duration,
        delay: stg(stagger, { start: delay }),
        easing: "easeOutCubic",
      });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

/**
 * Count-up animation for a numeric value.
 * Updates the element's textContent with formatted number.
 */
export function useCountUp<T extends HTMLElement>(
  value: number,
  options?: { duration?: number; format?: (n: number) => string; decimals?: number },
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const prevValue = useRef(0);
  const { duration = 800, format, decimals = 0 } = options ?? {};

  useEffect(() => {
    const el = ref.current;
    if (!el || value === 0) return;

    const from = prevValue.current;
    prevValue.current = value;

    let cancelled = false;
    (async () => {
      const { animate } = await import("animejs");
      if (cancelled) return;
      const obj = { val: from };
      animate(obj, {
        val: value,
        duration,
        easing: "easeOutExpo",
        onUpdate: () => {
          if (format) {
            el.textContent = format(obj.val);
          } else {
            el.textContent = obj.val.toFixed(decimals);
          }
        },
      });
    })();

    return () => { cancelled = true; };
  }, [value, duration, format, decimals]);

  return ref;
}

/**
 * Simple fade-in + slide animation on mount.
 */
export function useFadeIn<T extends HTMLElement>(
  options?: { duration?: number; translateY?: number; delay?: number },
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const { duration = 600, translateY = 12, delay = 0 } = options ?? {};

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = `translateY(${translateY}px)`;

    let cancelled = false;
    (async () => {
      const { animate } = await import("animejs");
      if (cancelled) return;
      animate(el, {
        opacity: [0, 1],
        translateY: [translateY, 0],
        duration,
        delay,
        easing: "easeOutCubic",
      });
    })();

    return () => { cancelled = true; };
  }, [duration, translateY, delay]);

  return ref;
}
