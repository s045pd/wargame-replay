import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

let mql: MediaQueryList | null = null;

function getMql() {
  if (!mql) mql = window.matchMedia(query);
  return mql;
}

function subscribe(cb: () => void) {
  const m = getMql();
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

function getSnapshot() {
  return getMql().matches;
}

function getServerSnapshot() {
  return false;
}

/** Returns true when viewport width < 768px */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
