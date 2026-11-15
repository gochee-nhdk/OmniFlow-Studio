import { Outlet, NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Server, Clock, AlertTriangle, Settings, Building2, ChevronRight, CheckCircle2, AlertCircle, X, Square, LoaderCircle
} from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { useEffect, useState } from 'react';
import EnterpriseProfilesModal from './EnterpriseProfilesModal';

export default function Layout() {
  const { refreshStatus, checkNetwork, errors, networkFeedback, dismissNetworkFeedback, isLoading, isStopping, activeProgress, stopWorkflow } = useAgentStore();
  const { loadProfiles, getActiveProfile } = useEnterpriseStore();
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);

  const criticalErrors = errors.filter(e => e.severity === 'CRITICAL' && !e.recovered).length;
  const activeProfile = getActiveProfile();

  useEffect(() => {
    refreshStatus();
    checkNetwork();
    loadProfiles();
    const interval = setInterval(() => {
      refreshStatus();
      checkNetwork();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  // Tự động tắt toast feedback sau 4 giây
  useEffect(() => {
    if (!networkFeedback) return;
    const timer = setTimeout(() => {
      dismissNetworkFeedback();
    }, 4000);
    return () => clearTimeout(timer);
  }, [networkFeedback?.timestamp]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 font-sans text-slate-800">
      {/* Toast thông báo kiểm tra mạng toàn cục */}
      {networkFeedback && (
        <div className="fixed top-4 right-6 z-50 transition-all duration-300 animate-in fade-in slide-in-from-top-2">
          <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-lg border text-xs font-medium ${
            networkFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : networkFeedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            {networkFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            )}
            <span>{networkFeedback.message}</span>
            <button
              onClick={dismissNetworkFeedback}
              className="ml-2 p-0.5 text-slate-400 hover:text-slate-700 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {isLoading && (
        <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-40 flex w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl">
          <LoaderCircle className={`h-5 w-5 flex-shrink-0 text-blue-600 ${isStopping ? '' : 'animate-spin'}`} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-900">{isStopping ? 'Đang dừng automation' : 'Automation đang chạy'}</div>
            <div className="truncate text-[11px] text-slate-500">{activeProgress?.stepName || 'Đang khởi tạo quy trình...'}</div>
          </div>
          <button
            type="button"
            onClick={() => { void stopWorkflow(); }}
            disabled={isStopping}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            {isStopping ? 'Đang dừng...' : 'Dừng Auto'}
          </button>
        </div>
      )}
      {/* Sidebar - Tối giản, thanh lịch, trung tính, không tốn tài nguyên */}
      <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Brand Header */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <img
              src="/omniflow-logo.jpg"
              alt="Logo"
              className="w-8 h-8 rounded-md object-cover border border-slate-200"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="overflow-hidden">
              <div className="text-slate-900 font-bold text-sm tracking-tight truncate">
                OmniFlow Studio
              </div>
              <div className="text-slate-500 text-[10px] font-medium tracking-wide truncate">
                RPA & ERP Automation
              </div>
            </div>
          </div>

          {/* Enterprise Profile Selector - Thiết kế phẳng, gọn gàng */}
          <button
            onClick={() => setIsProfilesModalOpen(true)}
            className="w-full mt-3 p-2 rounded-md bg-slate-50 border border-slate-200 hover:bg-slate-100 text-left transition-colors cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <div className="truncate text-xs font-semibold text-slate-700">
                {activeProfile?.name || 'Mặc định'}
              </div>
            </div>
            <span className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 px-1 py-0.5 rounded ml-1 flex-shrink-0">
              {activeProfile?.code || 'DEF'}
            </span>
          </button>
        </div>

        {/* Navigation - Đơn giản, rõ ràng, không hiệu ứng nặng */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {[
            { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { to: '/pos', icon: ShoppingCart, label: 'POS RPFO Web' },
            { to: '/sap', icon: Server, label: 'SAP B1 SLD' },
            { to: '/history', icon: Clock, label: 'Lịch sử & File' },
            { to: '/errors', icon: AlertTriangle, label: 'Trung tâm lỗi', badge: criticalErrors },
            { to: '/settings', icon: Settings, label: 'Cài đặt hệ thống' },
          ].map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {badge && badge > 0 ? (
                <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full min-w-[16px] text-center">
                  {badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 text-center">
          <div className="text-[10px] text-slate-400 font-mono">v1.0.0 • Automation Ready</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto bg-slate-50">
        <Outlet />
      </main>

      {/* Profile Modal */}
      <EnterpriseProfilesModal
        isOpen={isProfilesModalOpen}
        onClose={() => setIsProfilesModalOpen(false)}
      />
    </div>
  );
}
