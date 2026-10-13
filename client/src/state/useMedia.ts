import { useEffect, useState } from 'react';

/** Hormati prefers-reduced-motion: kurangi kecepatan dan jumlah partikel, jangan hapus informasi. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Layar sempit: label kanvas disembunyikan, legenda HTML yang menggantikannya. */
export function useNarrow(threshold = 600): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < threshold,
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < threshold);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [threshold]);
  return narrow;
}