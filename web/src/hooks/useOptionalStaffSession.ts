import { useEffect, useState } from 'react';
import { getSession, onTokenChange, type Session } from '../api/auth';

// setTimeout fires at once for delays above this (about 24.8 days).
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// The staff session on pages visitors also use: null for visitors and for a missing, expired or
// unverifiable session, never a redirect (staff-only pages use useStaffSession). It re-checks when
// the token is stored or cleared (in this tab or another), when the page returns to view and at
// the token's expiry, so staff-only controls disappear on logout or expiry without a reload.
// Without a token no request is made, so visitors cost the server nothing.
export function useOptionalStaffSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let check = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      const current = ++check;
      clearTimeout(expiry);
      getSession()
        .catch(() => null)
        .then((found) => {
          if (current !== check) return;
          setSession(found);
          if (found) {
            const ms = Math.min(Math.max(Date.parse(found.expiresAt) - Date.now(), 0), MAX_TIMEOUT_MS);
            expiry = setTimeout(refresh, ms);
          }
        });
    };
    const onVisible = () => document.visibilityState === 'visible' && refresh();

    refresh();
    const stopListening = onTokenChange(refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      check++;
      clearTimeout(expiry);
      stopListening();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return session;
}
