import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { roomUsage, SessionExpiredError, type RoomUsage } from '../api/admin';
import { clearToken } from '../api/auth';
import { useStaffSession } from '../hooks/useStaffSession';
import { Link, navigate } from '../router';
import './Staff.css';

type UsageState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rooms: RoomUsage[] };

const DAY_MS = 24 * 60 * 60 * 1000;
/** The UTC date (YYYY-MM-DD) `days` days before today; the report's bounds are UTC days. */
const utcDate = (daysAgo = 0) => new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);

// The owner's report: visits, distinct visitors and plays per room over a range of UTC days, both
// ends included (the last 30 days to start with). It is fetched again whenever a date changes; an
// empty date leaves that end of the range open.
export function Analytics() {
  const session = useStaffSession();
  const [from, setFrom] = useState(() => utcDate(29));
  const [to, setTo] = useState(() => utcDate());
  const [usage, setUsage] = useState<UsageState>({ status: 'loading' });
  // Only the latest request may update the table, so a slow earlier range cannot overwrite it.
  const latest = useRef(0);
  const ready = session.status === 'ready';
  // Dates in YYYY-MM-DD compare as strings.
  const rangeError = from && to && from > to ? 'The start date must be on or before the end date.' : null;

  useEffect(() => {
    if (!ready || rangeError) return;
    const request = ++latest.current;
    setUsage({ status: 'loading' });
    roomUsage({ from, to })
      .then((rooms) => request === latest.current && setUsage({ status: 'ready', rooms }))
      .catch((err) => {
        if (request !== latest.current) return;
        if (err instanceof SessionExpiredError) return navigate('/admin/login');
        setUsage({ status: 'error' });
      });
    return () => {
      latest.current++;
    };
  }, [ready, from, to, rangeError]);

  const logOut = () => {
    clearToken();
    navigate('/admin/login');
  };

  const total = (key: 'visits' | 'plays') =>
    usage.status === 'ready' ? usage.rooms.reduce((sum, room) => sum + room[key], 0) : 0;

  return (
    <main className="staff">
      <div className="staff-brand">
        <Link to="/admin">
          <span aria-hidden="true">←&nbsp;</span>Staff area
        </Link>
        {ready && (
          <button type="button" className="staff-button staff-button-secondary" onClick={logOut}>
            Log out
          </button>
        )}
      </div>
      <div className="staff-intro">
        <h1 className="title">Analytics</h1>
        {session.status === 'loading' && <p className="body-text">Checking your session…</p>}
        {session.status === 'error' && (
          <p className="body-text" role="alert">
            Could not check your session. Please try again later.
          </p>
        )}
        {ready && <p className="body-text">Room visits and track plays per room. Dates are in UTC.</p>}
      </div>
      {ready && (
        <>
          <section className="staff-section" aria-labelledby="analytics-range-title">
            <h2 className="staff-section-title" id="analytics-range-title">
              Date range
            </h2>
            <div className="staff-card">
              <div className="staff-row">
                <label className="staff-field">
                  From
                  <input className="staff-input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="staff-field">
                  To
                  <input className="staff-input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
              {rangeError && (
                <p className="staff-error" role="alert">
                  {rangeError}
                </p>
              )}
            </div>
          </section>
          <section className="staff-section" aria-labelledby="analytics-rooms-title">
            <h2 className="staff-section-title" id="analytics-rooms-title">
              Per room
            </h2>
            {!rangeError && usage.status === 'loading' && <p className="body-text">Loading the report…</p>}
            {!rangeError && usage.status === 'error' && (
              <p className="body-text" role="alert">
                Could not load the report. Please try again later.
              </p>
            )}
            {!rangeError && usage.status === 'ready' && usage.rooms.length === 0 && <p className="body-text">No rooms yet.</p>}
            {!rangeError && usage.status === 'ready' && usage.rooms.length > 0 && (
              <div className="staff-table-card">
                <table className="staff-table" aria-labelledby="analytics-rooms-title">
                  <thead>
                    <tr>
                      <th scope="col">Room</th>
                      <th scope="col">Visits</th>
                      <th scope="col">Visitors</th>
                      <th scope="col">Plays</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.rooms.map((room) => (
                      <tr key={room.id} style={{ '--room-colour': room.colour } as CSSProperties}>
                        <th scope="row">
                          <span className="staff-room-dot" aria-hidden="true" />
                          {room.name}
                        </th>
                        <td>{room.visits}</td>
                        <td>{room.visitors}</td>
                        <td>{room.plays}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">All rooms</th>
                      <td>{total('visits')}</td>
                      {/* A device can visit several rooms, so visitors do not add up across rooms. */}
                      <td />
                      <td>{total('plays')}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
