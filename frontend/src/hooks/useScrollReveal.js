import { useEffect, useRef } from "react";

/**
 * Intersection Observer hook — adds `data-revealed` when element enters viewport once.
 * Pair with `.scroll-reveal` CSS class for the fade-in transition.
 */
export default function useScrollReveal(options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.setAttribute("data-revealed", "");
          observer.unobserve(el);
        }
      },
      { threshold: 0.12, ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
