'use client';

import { useCallback, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_INTERVAL_MS = 30_000;
const MINIMUM_REFRESH_GAP_MS = 5_000;

export default function PortalAutoRefresh() {
  const router = useRouter();
  const lastRefreshAt = useRef(Date.now());
  const [, startTransition] = useTransition();

  const refreshPortal = useCallback(() => {
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();
    if (now - lastRefreshAt.current < MINIMUM_REFRESH_GAP_MS) return;

    lastRefreshAt.current = now;
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshPortal();
    };

    window.addEventListener('focus', refreshPortal);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(refreshPortal, REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', refreshPortal);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [refreshPortal]);

  return null;
}
