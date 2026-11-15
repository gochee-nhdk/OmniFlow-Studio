import { Play, Square, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import StatusBadge from '../components/StatusBadge';

export default function AutomationPage() {
  const { currentRun, isLoading, stopWorkflow, startWorkflow, pendingUserAction, respondToUserAction } = useAgentStore();

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Automation Engine</h1>
        <p className="text-slate-500 text-sm mt-1">Real-time workflow execution & step-by-step progress</p>
      </div>

      {/* Human Intervention Alert (e.g. SAP concurrent login) */}
      {pendingUserAction && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-3 flex-1">
              <h3 className="text-base font-bold text-amber-900">Action Required: Confirmation</h3>
              <p className="text-sm text-amber-800">{pendingUserAction.message}</p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => respondToUserAction(pendingUserAction.runId, true)}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors"
                >
                  Confirm & Continue
                </button>
                <button
                  onClick={() => respondToUserAction(pendingUserAction.runId, false)}
                  className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors"
                >
                  Cancel Workflow
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Workflow Execution Box */}
      {currentRun ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <div className="text-lg font-bold text-slate-900">{currentRun.workflowType.replace(/_/g, ' ')}</div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono">Run ID: {currentRun.id}</div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status="running" label={currentRun.status} />
              <button
                onClick={stopWorkflow}
                className="flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 text-sm font-medium px-3 py-1.5 rounded-lg border border-red-200 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop
              </button>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Execution Pipeline</h3>
            {currentRun.steps && currentRun.steps.length > 0 ? (
              <div className="space-y-2">
                {currentRun.steps.map((step, idx) => (
                  <div key={step.id || idx} className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center gap-3">
                      {step.status === 'SUCCESS' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : step.status === 'RUNNING' ? (
                        <Clock className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-slate-300" />
                      )}
                      <span className="text-sm font-medium text-slate-800">{step.stepName}</span>
                    </div>
                    <span className="text-xs text-slate-500">{step.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400 text-sm">Pipeline initializing...</div>
            )}
          </div>
        </div>
      ) : (
        /* Idle State */
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-4">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-600">
            <Play className="w-6 h-6 ml-0.5" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Automation Engine Idle</h2>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            No workflow is currently executing. You can trigger daily procurement or individual downloads at any time.
          </p>
          <button
            onClick={() => startWorkflow('DAILY_PROCUREMENT')}
            disabled={isLoading}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            Run Daily Procurement
          </button>
        </div>
      )}
    </div>
  );
}
