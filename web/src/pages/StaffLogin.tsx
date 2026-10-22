import { useState, type FormEvent } from 'react';
import { login, LoginError } from '../api/auth';
import { Link, navigate } from '../router';
import './Staff.css';

export function StaffLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate('/admin');
    } catch (err) {
      setError(err instanceof LoginError ? err.message : 'Could not log in. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="staff">
      <div className="staff-brand">
        <span className="label">Music Rooms</span>
        <Link to="/">← All rooms</Link>
      </div>
      <div className="staff-intro">
        <h1 className="title">Staff login</h1>
        <p className="body-text">Log in with the staff account to manage rooms and their tracks.</p>
      </div>
      <form className="staff-card" onSubmit={onSubmit}>
        <label className="staff-field">
          Username
          <input
            className="staff-input"
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="staff-field">
          Password
          <input
            className="staff-input"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="staff-button" disabled={submitting}>
          Log in
        </button>
      </form>
    </main>
  );
}
