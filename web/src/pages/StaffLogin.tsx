import { useState, type FormEvent } from 'react';
import { login, LoginError } from '../api/auth';
import { Link, navigate } from '../router';

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
    <main className="page">
      <Link to="/" className="back-link">
        ← All rooms
      </Link>
      <h1>Staff login</h1>
      <form className="login-form" onSubmit={onSubmit}>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          Log in
        </button>
      </form>
    </main>
  );
}
