'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

// Not rendered until `visible` flips, so the three.js chunk is never requested on a
// first paint. That is what keeps the LCP budget of PRD Section 10.7 reachable.
const HeroCanvas = dynamic(() => import('./hero-canvas'), { ssr: false });

/**
 * The 3D hero of PRD Section 9.1 / F-ST-10.
 *
 * Two rules it exists to honour:
 *   - `prefers-reduced-motion` stops the auto-rotation and the pointer parallax
 *   - the renderer only mounts once the hero is on screen, and unmounts nothing
 *     until then, so the page paints without waiting on WebGL
 */
export function Hero3D({ className, modelUrl }: { className?: string; modelUrl?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={className} aria-hidden>
      {visible ? <HeroCanvas animate={!reducedMotion} modelUrl={modelUrl} /> : null}
    </div>
  );
}

/**
 * Starts pessimistic: motion stays off through the server render and the first client
 * frame, so a visitor who asked for reduced motion never sees a single spin.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
