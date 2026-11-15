import { useEffect, useState } from 'react';
import { useAgentStore } from '../store/agentStore';
import StatusBadge from '../components/StatusBadge';
import { formatDistanceToNow, format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { invoke } from '../lib/ipc';

interface DownloadHistoryItem {
  id: string; fileName: string; reportType: string; rowCount?: number; filePath: string; downloadedAt: string;
}

export default function HistoryPage() {
  const { recentRuns, loadHistory, isLoading } = useAgentStore();
  const [files, setFiles] = useState<DownloadHistoryItem[]>([]);
  const loadFiles = () => invoke<DownloadHistoryItem[]>('files:history', { limit: 50 }).then((items) => setFiles(items || [])).catch(() => setFiles([]));

  useEffect(() => {
    loadHistory();
    loadFiles();
  }, []);

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Execution History</h1>
          <p className="text-slate-500 text-sm mt-1">Audit log of all past procurement and download workflows</p>
        </div>
        <button
          onClick={() => { loadHistory(); loadFiles(); }}
          disabled={isLoading}
          className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3.5 py-2 rounded-lg cursor-pointer transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Danh sách File Báo cáo Đã Tải Về</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr>
              <th className="px-5 py-3 text-left">Tên file</th><th className="px-5 py-3 text-left">Loại</th><th className="px-5 py-3 text-right">Số dòng</th><th className="px-5 py-3 text-left">Đường dẫn</th><th className="px-5 py-3 text-left">Thời gian tải</th><th className="px-5 py-3" />
            </tr></thead>
            <tbody>{files.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Chưa có file báo cáo.</td></tr> : files.map((file) => (
              <tr key={file.id} className="border-t border-slate-100"><td className="px-5 py-3 font-medium">{file.fileName}</td><td className="px-5 py-3">{file.reportType}</td><td className="px-5 py-3 text-right">{file.rowCount ?? '—'}</td><td className="px-5 py-3 text-xs break-all">{file.filePath}</td><td className="px-5 py-3">{format(new Date(file.downloadedAt), 'dd/MM/yyyy HH:mm')}</td><td className="px-5 py-3"><button className="text-blue-600 hover:underline whitespace-nowrap" onClick={() => invoke('files:open-dir', { path: file.filePath.replace(/[\\/][^\\/]*$/, '') })}>Mở thư mục</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
              <th className="px-6 py-3.5 text-left font-medium">Run ID</th>
              <th className="px-6 py-3.5 text-left font-medium">Workflow</th>
              <th className="px-6 py-3.5 text-left font-medium">Started At</th>
              <th className="px-6 py-3.5 text-left font-medium">Duration</th>
              <th className="px-6 py-3.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-sm">
                  No execution records found in local SQLite database.
                </td>
              </tr>
            ) : (
              recentRuns.map((run) => (
                <tr key={run.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-6 py-4 text-xs font-mono text-slate-500">{run.id.slice(0, 8)}...</td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">{run.workflowType.replace(/_/g, ' ')}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    <div>{format(new Date(run.startedAt), 'dd/MM/yyyy HH:mm:ss')}</div>
                    <div className="text-xs text-slate-400">{formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-6 py-4">
                    <StatusBadge
                      status={
                        run.status === 'SUCCESS' ? 'success' :
                        run.status === 'FAILED' ? 'error' :
                        run.status === 'RUNNING' ? 'running' : 'warning'
                      }
                      label={run.status.replace(/_/g, ' ')}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
