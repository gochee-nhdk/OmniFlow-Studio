import { useEffect } from 'react';
import { useAgentStore } from '../store/agentStore';
import { AlertTriangle, Trash2, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

export default function ErrorCenterPage() {
  const { errors, loadErrors, clearErrors } = useAgentStore();

  useEffect(() => {
    loadErrors();
  }, []);

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Error Center</h1>
          <p className="text-slate-500 text-sm mt-1">Diagnostic logs, automated recovery triggers, and issue resolutions</p>
        </div>
        {errors.length > 0 && (
          <button
            onClick={clearErrors}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3.5 py-2 rounded-lg cursor-pointer transition-colors"
          >
            <Trash2 className="w-4 h-4 text-slate-400" />
            Clear Log
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {errors.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h3 className="text-base font-semibold text-slate-900">Zero Unresolved Errors</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">All systems operational. Any future browser timeouts, authentication failures, or download errors will be tracked here.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">
                <th className="px-6 py-3.5 text-left font-medium">Severity</th>
                <th className="px-6 py-3.5 text-left font-medium">Error Type</th>
                <th className="px-6 py-3.5 text-left font-medium">Message</th>
                <th className="px-6 py-3.5 text-left font-medium">Timestamp</th>
                <th className="px-6 py-3.5 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((err) => (
                <tr key={err.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                      err.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                      err.severity === 'ERROR' ? 'bg-orange-100 text-orange-700' :
                      err.severity === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {err.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-mono font-medium text-slate-700">{err.errorType}</td>
                  <td className="px-6 py-4 text-sm text-slate-800 max-w-md truncate">{err.message}</td>
                  <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                    {format(new Date(err.createdAt), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="px-6 py-4 text-xs">
                    {err.recovered ? (
                      <span className="text-emerald-600 font-medium">Auto-Recovered</span>
                    ) : (
                      <span className="text-red-500 font-medium">Requires Attention</span>
                    )}
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
