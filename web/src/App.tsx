import { RoomPage } from './pages/RoomPage';
import { RoomSelection } from './pages/RoomSelection';
import { StaffArea } from './pages/StaffArea';
import { StaffLogin } from './pages/StaffLogin';
import { usePathname } from './router';

export function App() {
  const pathname = usePathname();

  const room = /^\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (room) return <RoomPage key={room[1]} id={decodeURIComponent(room[1])} />;
  if (/^\/admin\/login\/?$/.test(pathname)) return <StaffLogin />;
  if (/^\/admin\/?$/.test(pathname)) return <StaffArea />;

  return <RoomSelection />;
}
