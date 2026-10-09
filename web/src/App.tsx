import { useEffect, useState } from 'react';

export function App() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/hello')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { message: string }) => setMessage(data.message))
      .catch(() => setError(true));
  }, []);

  return <h1>{error ? 'Failed to load greeting' : (message ?? 'Loading…')}</h1>;
}
