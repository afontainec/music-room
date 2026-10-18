import { useEffect, useState } from 'react';
import { getSession, type Session } from '../api/auth';
import { navigate } from '../router';

export type StaffSessionState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; session: Session };

// The gate for staff pages: without a valid session it sends the visitor to the login page.
// The admin API checks the token on every call as well, so this is a convenience, not the guard.
export function useStaffSession(): StaffSessionState {
  const [state, setState] = useState<StaffSessionState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (!active) return;
        if (session) setState({ status: 'ready', session });
        else navigate('/admin/login');
      })
      .catch(() => active && setState({ status: 'error' }));
    return () => {
      active = false;
    };
  }, []);

  return state;
}
