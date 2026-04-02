import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";

interface AppTabBranchBadgeProps {
  label: string;
  title: string;
  className?: string;
}

interface MarqueeMetrics {
  distance: number;
  duration: number;
  overflow: boolean;
}

const MARQUEE_GAP_PX = 18;
const MARQUEE_PIXELS_PER_SECOND = 16;
const MIN_MARQUEE_DURATION_SECONDS = 9;

const INITIAL_METRICS: MarqueeMetrics = {
  distance: 0,
  duration: MIN_MARQUEE_DURATION_SECONDS,
  overflow: false,
};

export function AppTabBranchBadge({
  label,
  title,
  className = "app-tab__branch",
}: AppTabBranchBadgeProps): JSX.Element {
  const viewportRef = useRef<HTMLSpanElement | null>(null);
  const copyRef = useRef<HTMLSpanElement | null>(null);
  const [metrics, setMetrics] = useState<MarqueeMetrics>(INITIAL_METRICS);

  useEffect(() => {
    const viewportNode = viewportRef.current;
    const copyNode = copyRef.current;
    if (!viewportNode || !copyNode) {
      return;
    }

    const updateMetrics = (): void => {
      const containerWidth = viewportNode.clientWidth;
      const contentWidth = copyNode.scrollWidth;
      const overflow = contentWidth - containerWidth > 1;

      if (!overflow) {
        setMetrics((current) => (current.overflow ? INITIAL_METRICS : current));
        return;
      }

      const distance = contentWidth + MARQUEE_GAP_PX;
      const duration = Math.max(MIN_MARQUEE_DURATION_SECONDS, distance / MARQUEE_PIXELS_PER_SECOND);

      setMetrics((current) => {
        if (current.overflow && current.distance === distance && current.duration === duration) {
          return current;
        }

        return {
          distance,
          duration,
          overflow: true,
        };
      });
    };

    updateMetrics();

    if (typeof ResizeObserver === "undefined") {
      if (typeof window === "undefined") {
        return;
      }

      window.addEventListener("resize", updateMetrics);
      return () => {
        window.removeEventListener("resize", updateMetrics);
      };
    }

    const observer = new ResizeObserver(updateMetrics);
    observer.observe(viewportNode);
    observer.observe(copyNode);

    return () => {
      observer.disconnect();
    };
  }, [label]);

  const style = metrics.overflow
    ? ({
        "--app-tab-branch-marquee-distance": `${metrics.distance}px`,
        "--app-tab-branch-marquee-duration": `${metrics.duration}s`,
        "--app-tab-branch-marquee-gap": `${MARQUEE_GAP_PX}px`,
      } as CSSProperties)
    : undefined;

  return (
    <span
      className={`${className}${metrics.overflow ? " is-overflowing" : ""}`}
      title={title}
      aria-label={label}
      style={style}
    >
      <span ref={viewportRef} className="app-tab__branch-viewport" aria-hidden="true">
        <span className="app-tab__branch-track">
          <span ref={copyRef} className="app-tab__branch-copy">
            {label}
          </span>
          {metrics.overflow ? (
            <>
              <span className="app-tab__branch-gap" />
              <span className="app-tab__branch-copy">{label}</span>
            </>
          ) : null}
        </span>
      </span>
    </span>
  );
}
