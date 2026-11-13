import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Play, Clock, AlertTriangle, Settings, Zap } from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useEffect } from 'react';

export default function Layout() {
  const { refreshStatus, checkNetwork, errors } = useAgentStore();
  const criticalErrors = errors.filter(e => e.severity === 'CRITICAL' && !e.recovered).length;

  useEffect(() => {
    refreshStatus();
    checkNetwork();
    const interval = setInterval(() => { refreshStatus(); }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-slate-950 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-none">FM AUTO OPS</div>
              <div className="text-slate-500 text-xs mt-1">Enterprise RPA</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {[
            { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { to: '/automation', icon: Play, label: 'Automation' },
            { to: '/history', icon: Clock, label: 'History' },
            { to: '/errors', icon: AlertTriangle, label: 'Error Center', badge: criticalErrors },
            { to: '/settings', icon: Settings, label: 'Settings' },
          ].map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {badge && badge > 0 ? (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800">
          <div className="text-xs text-slate-500 text-center font-mono">LOCAL RPA AGENT</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
