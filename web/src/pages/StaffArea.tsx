import { useEffect, useState } from 'react';
import { clearToken, getSession, type Session } from '../api/auth';
import { navigate } from '../router';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; session: Session };

// The gate for the staff dashboard: without a valid session it sends the visitor to the login page.
// The admin API checks the token on every call as well, so this is a convenience, not the guard.
export function StaffArea() {
  const [state, setState] = useState<State>({ status: 'loading' });

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

  const logOut = () => {
    clearToken();
    navigate('/admin/login');
  };

  return (
    <main className="page">
      <h1>Staff area</h1>
      {state.status === 'loading' && <p className="status">Checking your session…</p>}
      {state.status === 'error' && (
        <p className="status" role="alert">
          Could not check your session. Please try again later.
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <p className="status">Signed in as {state.session.username}.</p>
          <p className="status">Room and file management will appear here.</p>
          <button type="button" className="secondary-button" onClick={logOut}>
            Log out
          </button>
        </>
      )}
    </main>
  );
}
