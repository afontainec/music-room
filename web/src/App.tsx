import { AdminRoomPage } from './pages/AdminRoomPage';
import { RoomPage } from './pages/RoomPage';
import { RoomSelection } from './pages/RoomSelection';
import { StaffArea } from './pages/StaffArea';
import { StaffLogin } from './pages/StaffLogin';
import { usePathname } from './router';

export function App() {
  const pathname = usePathname();

  const room = /^\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (room) return <RoomPage key={room[1]} id={decodeURIComponent(room[1])} />;
  const adminRoom = /^\/admin\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (adminRoom) return <AdminRoomPage key={adminRoom[1]} id={decodeURIComponent(adminRoom[1])} />;
  if (/^\/admin\/login\/?$/.test(pathname)) return <StaffLogin />;
  if (/^\/admin\/?$/.test(pathname)) return <StaffArea />;

  return <RoomSelection />;
}
