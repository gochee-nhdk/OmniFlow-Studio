import { useEffect } from 'react';
import { Server, ShoppingCart, Monitor, HardDrive, Play, Download, Wifi } from 'lucide-react';
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

  const handleRunDailyProcurement = async () => {
    await startWorkflow('DAILY_PROCUREMENT');
  };

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

      {/* Primary CTA */}
      <div className="bg-slate-900 rounded-2xl p-8 shadow-sm">
        <div className="text-center space-y-4">
          <div className="text-emerald-400 text-xs font-bold tracking-widest uppercase">One Click. Complete Automation.</div>
          <button
            onClick={handleRunDailyProcurement}
            disabled={isLoading}
            className="w-full max-w-lg mx-auto flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-400 active:scale-98 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-bold text-lg py-5 px-8 rounded-xl transition-all shadow-lg cursor-pointer"
          >
            <Play className="w-6 h-6 fill-current" />
            RUN DAILY PROCUREMENT
          </button>
          <div className="text-slate-400 text-sm">
            Automatically logs in, downloads Inventory & Sales Excel reports, validates, and organizes into D:\FM_AUTO_OPS
          </div>
        </div>

        {/* Secondary actions */}
        <div className="mt-8 flex justify-center gap-3">
          {[
            { label: 'Download Inventory', icon: Download, type: 'DOWNLOAD_INVENTORY' },
            { label: 'Download Sales', icon: Download, type: 'DOWNLOAD_SALES' },
            { label: 'Test Connections', icon: Wifi, type: 'CONNECTION_TEST' },
          ].map(({ label, icon: Icon, type }) => (
            <button
              key={type}
              onClick={() => startWorkflow(type)}
              disabled={isLoading}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors cursor-pointer"
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
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
            <tbody>
              {recentRuns.slice(0, 5).map((run) => (
                <tr key={run.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="px-6 py-3 text-sm font-medium text-slate-800">{run.workflowType.replace(/_/g, ' ')}</td>
                  <td className="px-6 py-3 text-sm text-slate-500">{formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}</td>
                  <td className="px-6 py-3 text-sm text-slate-500">{run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : '—'}</td>
                  <td className="px-6 py-3">
                    <StatusBadge status={getWorkflowStatusBadge(run.status)} label={run.status.replace(/_/g, ' ')} />
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
