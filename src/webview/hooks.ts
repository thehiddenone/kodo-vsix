import { useState, useEffect } from 'preact/hooks';
/** Re-render on a 250ms tick so a live elapsed timer stays current. */
export function useElapsedTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(id);
  }, [active]);
}
