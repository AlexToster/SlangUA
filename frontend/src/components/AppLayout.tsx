import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import './AppLayout.css';

export function AppLayout() {
  return (
    <div className="app-layout">
      <main className="app-layout-content">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}

export default AppLayout;
