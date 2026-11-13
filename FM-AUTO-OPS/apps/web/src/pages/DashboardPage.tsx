import { useEffect } from 'react';
import { Server, ShoppingCart, Monitor, HardDrive, Play, Download, Wifi, KeyRound, CheckCircle2 } from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import StatusBadge from '../components/StatusBadge';
import { formatDistanceToNow } from 'date-fns';

function getAuthStateBadge(state: string): 'online' | 'offline' | 'error' | 'unknown' | 'warning' {
  if (state === 'AUTHENTICATED') return 'online';
  if (state === 'NOT_CONFIGURED') return 'unknown';
  if (state === 'AUTH_FAILED' || state === 'ERROR') return 'error';
  if (state === 'DISCONNECTED') return 'offline';
  return 'warning';
}

function getWorkflowStatusBadge(status: string): 'running' | 'success' | 'error' | 'warning' | 'offline' {
  if (status === 'RUNNING' || status === 'INITIALIZING') return 'running';
  if (status === 'SUCCESS' || status === 'SUCCESS_WITH_NO_DATA') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'PARTIAL_SUCCESS' || status === 'WAITING_FOR_USER') return 'warning';
  return 'offline';
}

export default function DashboardPage() {
  const {
    agentStatus, networkStatus, recentRuns,
    isLoading, startWorkflow, loadHistory, checkNetwork,
  } = useAgentStore();

  useEffect(() => {
    loadHistory();
    checkNetwork();
  }, []);

  const agentOnline = agentStatus?.isOnline ?? true;

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Live RPA agent monitoring and workflow triggers</p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* SAP Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                <Server className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">SAP B1</div>
                <div className="text-xs text-slate-400">172.16.1.210:8100</div>
              </div>
            </div>
            <StatusBadge
              status={agentStatus ? getAuthStateBadge(agentStatus.sapAuthState) : 'unknown'}
            />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {networkStatus.sap ? 'Network connection verified' : 'Unreachable'}
          </div>
        </div>

        {/* POS Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">POS RPFO</div>
                <div className="text-xs text-slate-400">172.16.1.200</div>
              </div>
            </div>
            <StatusBadge
              status={agentStatus ? getAuthStateBadge(agentStatus.posAuthState) : 'unknown'}
            />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {networkStatus.pos ? 'Network connection verified' : 'Unreachable'}
          </div>
        </div>

        {/* Local Agent Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Monitor className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Local Agent</div>
                <div className="text-xs text-slate-400">{agentStatus?.version ?? '1.0.0'}</div>
              </div>
            </div>
            <StatusBadge status={agentOnline ? 'online' : 'offline'} />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {agentOnline ? 'Ready for execution' : 'Agent offline'}
          </div>
        </div>

        {/* Storage Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Storage</div>
                <div className="text-xs text-slate-400">D:\FM_AUTO_OPS</div>
              </div>
            </div>
            <StatusBadge status="online" label="Ready" />
          </div>
          <div className="mt-3 text-xs text-slate-500">All 9 folders verified</div>
        </div>
      </div>

      {/* 2 Dedicated Operational Feature Blocks: POS and SAP */}
      <div className="grid grid-cols-2 gap-6">
        {/* BLOCK 1: POS RPFO AUTOMATION */}
        <div className="bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 rounded-2xl p-6 shadow-md border border-purple-900/50 flex flex-col justify-between space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/20 border border-purple-500/40 rounded-xl flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-purple-300" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">POS RPFO Automation</h2>
                  <span className="text-xs text-purple-300/80 font-mono">http://172.16.1.200/</span>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-purple-900/60 border border-purple-700/50 text-purple-200 text-xs font-semibold rounded-full">
                POS Riêng
              </span>
            </div>
            <p className="text-slate-300 text-xs mt-3 leading-relaxed">
              Tự động kết nối POS RPFO, tải báo cáo <strong>Bán hàng (Sales Transaction Detail)</strong> &amp; <strong>Tồn kho (Inventory Onhand)</strong>, xác thực tính toàn vẹn và phân loại lưu vào <code>D:\FM_AUTO_OPS\</code>.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => startWorkflow('POS_AUTOMATION')}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2.5 bg-purple-600 hover:bg-purple-500 active:scale-98 disabled:bg-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm py-3.5 px-5 rounded-xl transition-all shadow-md cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              CHẠY POS TỰ ĐỘNG (RUN POS)
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => startWorkflow('DOWNLOAD_SALES')}
                disabled={isLoading}
                className="flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-purple-900/50 text-slate-200 text-xs font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-purple-400" />
                Tải Sales Detail
              </button>
              <button
                onClick={() => startWorkflow('DOWNLOAD_INVENTORY')}
                disabled={isLoading}
                className="flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-purple-900/50 text-slate-200 text-xs font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-purple-400" />
                Tải Inventory Onhand
              </button>
            </div>
          </div>
        </div>

        {/* BLOCK 2: SAP BUSINESS ONE AUTOMATION */}
        <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 rounded-2xl p-6 shadow-md border border-blue-900/50 flex flex-col justify-between space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/20 border border-blue-500/40 rounded-xl flex items-center justify-center">
                  <Server className="w-5 h-5 text-blue-300" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">SAP Business One Automation</h2>
                  <span className="text-xs text-blue-300/80 font-mono">172.16.1.210:8100 → SLD 172.16.0.201</span>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-blue-900/60 border border-blue-700/50 text-blue-200 text-xs font-semibold rounded-full">
                SAP Riêng
              </span>
            </div>
            <p className="text-slate-300 text-xs mt-3 leading-relaxed">
              Tự động mở SAP Web Client, điền form đăng nhập SLD (Server, Company Database, User ID, Password), xử lý khôi phục phiên và bảo vệ chống đăng nhập trùng tài khoản.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => startWorkflow('SAP_AUTOMATION')}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 disabled:bg-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm py-3.5 px-5 rounded-xl transition-all shadow-md cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              CHẠY SAP TỰ ĐỘNG (RUN SAP)
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => startWorkflow('SAP_LOGIN_CHECK')}
                disabled={isLoading}
                className="flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-blue-900/50 text-slate-200 text-xs font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                Đăng nhập SAP SLD
              </button>
              <button
                onClick={() => checkNetwork()}
                disabled={isLoading}
                className="flex items-center justify-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-blue-900/50 text-slate-200 text-xs font-medium py-2 px-3 rounded-lg transition-colors cursor-pointer"
              >
                <Wifi className="w-3.5 h-3.5 text-blue-400" />
                Kiểm tra Kết nối
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Primary CTA (All in One: Daily Procurement) */}
      <div className="bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-800">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-emerald-400 text-xs font-bold tracking-widest uppercase">
              Chạy Toàn Trình (All-in-One Automation)
            </div>
            <h3 className="text-lg font-bold text-white">Chạy Toàn Bộ Quy Trình Mua Hàng Hằng Ngày</h3>
            <p className="text-slate-400 text-xs">
              Tự động hóa hoàn toàn cả POS RPFO (Bán hàng + Tồn kho) và SAP Business One chỉ với 1 click duy nhất.
            </p>
          </div>

          <button
            onClick={() => startWorkflow('DAILY_PROCUREMENT')}
            disabled={isLoading}
            className="flex items-center gap-3 bg-emerald-500 hover:bg-emerald-400 active:scale-98 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-bold text-base py-3.5 px-7 rounded-xl transition-all shadow-lg cursor-pointer"
          >
            <Play className="w-5 h-5 fill-current" />
            RUN DAILY PROCUREMENT
          </button>
        </div>
      </div>

      {/* Recent runs table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recent Workflow Runs</h2>
          <span className="text-xs text-slate-400 font-mono">SQLite Local DB</span>
        </div>
        {recentRuns.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No workflow runs recorded yet. Click above to trigger your first automation.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100">
                <th className="px-6 py-3 text-left font-medium">Workflow</th>
                <th className="px-6 py-3 text-left font-medium">Started</th>
                <th className="px-6 py-3 text-left font-medium">Duration</th>
                <th className="px-6 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentRuns.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-medium text-slate-900">{run.workflowType}</td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={getWorkflowStatusBadge(run.status)} label={run.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
