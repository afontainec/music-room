import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

// A minimal History API router: the server falls back to index.html for every non-API path,
// so client-side paths survive a reload. Swap for react-router once routes need nesting.

const NAVIGATE_EVENT = 'app:navigate';

export function navigate(to: string) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return pathname;
}

type LinkProps = { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>;

export function Link({ to, children, ...rest }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle new-tab and other modified clicks.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a {...rest} href={to} onClick={onClick}>
      {children}
    </a>
  );
}
