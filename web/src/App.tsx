import { RoomPage } from './pages/RoomPage';
import { RoomSelection } from './pages/RoomSelection';
import { usePathname } from './router';

export function App() {
  const pathname = usePathname();

  const room = /^\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (room) return <RoomPage key={room[1]} id={decodeURIComponent(room[1])} />;

  return <RoomSelection />;
}
