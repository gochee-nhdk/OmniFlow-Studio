import React, { useEffect, useState } from 'react';
import {
  Server, ShoppingCart, Monitor, HardDrive, Play, ArrowRight,
  RefreshCw, Building2, ExternalLink, Zap
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAgentStore } from '../store/agentStore';
import { useEnterpriseStore } from '../store/enterpriseStore';
import StatusBadge from '../components/StatusBadge';
import EnterpriseProfilesModal from '../components/EnterpriseProfilesModal';
import { invoke } from '../lib/ipc';

function getAuthStateBadge(state: string): 'online' | 'offline' | 'error' | 'unknown' | 'warning' {
  if (state === 'AUTHENTICATED') return 'online';
  if (state === 'NOT_CONFIGURED') return 'unknown';
  if (state === 'AUTH_FAILED' || state === 'ERROR') return 'error';
  if (state === 'DISCONNECTED') return 'offline';
  return 'warning';
}

const SAP_MODULE_LABELS: Record<string, string> = {
  HOME: 'Trang chủ SAP',
  PURCHASING_PO: 'Đặt Hàng (PO)',
  PURCHASING_RETURN: 'Xuất Trả (Return)',
  PURCHASING_GRPO: 'Nhận Hàng (GRPO)',
};

export default function DashboardPage() {
  const {
    agentStatus, networkStatus, isCheckingNetwork,
    isLoading, startWorkflow, loadHistory, checkNetwork, refreshStatus
  } = useAgentStore();

  const { profiles, activeProfileId, setActiveProfile, getActiveProfile } = useEnterpriseStore();
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);

  // Quick-action config summary from persisted settings
  const [configSummary, setConfigSummary] = useState<{
    salesFromDate: string;
    salesToDate: string;
    slocCount: number;
    sapTargetModule: string;
  }>({ salesFromDate: '', salesToDate: '', slocCount: 0, sapTargetModule: 'HOME' });

  const activeProfile = getActiveProfile();

  useEffect(() => {
    loadHistory();
    checkNetwork();
    refreshStatus();
    // Load saved settings for the summary panel
    invoke<any>('settings:get').then((data: any) => {
      if (!data) return;
      setConfigSummary({
        salesFromDate: data.posSalesFromDate || '',
        salesToDate: data.posSalesToDate || '',
        slocCount: Array.isArray(data.posSelectedInvSlocs) ? data.posSelectedInvSlocs.length : 0,
        sapTargetModule: data.sapTargetModule || 'HOME',
      });
    }).catch(() => null);
    // No duplicate setInterval here — Layout.tsx already polls every 60s
  }, []);

  const agentOnline = agentStatus?.isOnline ?? true;

  const handleRunDaily = async () => {
    await startWorkflow('DAILY_PROCUREMENT', {
      includeSales: true,
      includeInventory: true,
    });
  };

  const openFolder = (path: string) => {
    invoke('files:open-dir', { path }).catch(() => null);
  };

  // Quick-action handler: fires invoke directly then delegates to startWorkflow for status tracking
  const handleQuickAction = async (type: string, extraOptions: Record<string, any> = {}) => {
    await startWorkflow(type, extraOptions);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header gọn gàng */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Trung tâm Điều khiển Automation</h1>
          <p className="text-slate-500 text-xs mt-0.5">
            Tổng quan hệ thống tự động hóa mua hàng, xuất báo cáo POS và đồng bộ dữ liệu ERP
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { checkNetwork({ showFeedback: true }); refreshStatus(); loadHistory(); }}
            disabled={isCheckingNetwork}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded transition-colors ${
              isCheckingNetwork
                ? 'text-blue-700 bg-blue-50 cursor-wait'
                : 'text-slate-700 bg-white hover:bg-slate-50 cursor-pointer'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCheckingNetwork ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            {isCheckingNetwork ? 'Đang làm mới...' : 'Làm mới'}
          </button>
        </div>
      </div>

      {/* Thanh thông tin Hồ sơ Doanh nghiệp phẳng, sạch sẽ */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 flex-shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">{activeProfile?.name || 'Mặc định'}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-100 border border-slate-200 text-slate-600 rounded">
                {activeProfile?.code || 'DEFAULT'}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 flex gap-4">
              <span>Hệ thống: <strong className="text-slate-700">{activeProfile?.erpType || 'SAP_B1'}</strong></span>
              <span>Schema: <strong className="text-slate-700">{activeProfile?.companySchema || 'DEMO_ORG'}</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <select
            value={activeProfileId}
            onChange={(e) => setActiveProfile(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 text-xs rounded px-2.5 py-1.5 focus:outline-none focus:border-slate-400 cursor-pointer"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} - {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setIsProfilesModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded transition-colors cursor-pointer"
          >
            Quản lý hồ sơ
          </button>
        </div>
      </div>

      {/* 4 Thẻ trạng thái kết nối đơn giản, trực quan */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* POS */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-800">POS RPFO</span>
              </div>
              <StatusBadge status={networkStatus?.pos ? 'online' : 'offline'} />
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Tải Excel Doanh số &amp; Tồn kho tự động
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-slate-100">
            <Link
              to="/pos"
              className="text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center justify-between"
            >
              <span>Vào công cụ POS</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>
          </div>
        </div>

        {/* SAP */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-800">SAP Business One</span>
              </div>
              <StatusBadge
                status={!networkStatus?.sap ? 'offline' : (agentStatus ? getAuthStateBadge(agentStatus.sapAuthState) : 'unknown')}
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Xác thực SLD &amp; Đồng bộ dữ liệu
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-slate-100">
            <Link
              to="/sap"
              className="text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center justify-between"
            >
              <span>Vào công cụ SAP</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>
          </div>
        </div>

        {/* Engine */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-800">RPA Engine</span>
              </div>
              <StatusBadge status={agentOnline ? 'online' : 'offline'} />
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Edge/Chrome với hồ sơ riêng của OmniFlow, không dùng chung tab cá nhân
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-slate-100 text-xs text-slate-400 font-mono">
            Sẵn sàng
          </div>
        </div>

        {/* Data Directory */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-800">Thư mục Dữ liệu</span>
              </div>
              <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Local</span>
            </div>
            <p className="text-xs text-slate-500 mt-2 truncate font-mono">
              {activeProfile?.exportPath || 'Documents\\OmniFlow_Reports'}
            </p>
          </div>
          <div className="pt-3 mt-3 border-t border-slate-100">
            <button
              onClick={() => openFolder(activeProfile?.exportPath || 'Documents\\OmniFlow_Reports')}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center justify-between w-full cursor-pointer"
            >
              <span>Mở thư mục</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick-Action Procurement Hub */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-500" />
              Trung tâm Mua Hàng Nhanh
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Kích hoạt từng bước hoặc toàn bộ quy trình tự động mua hàng
            </p>
          </div>

          {/* Config summary */}
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="bg-slate-100 border border-slate-200 text-slate-700 rounded px-2 py-1 font-mono">
              📅 {configSummary.salesFromDate || '--'} → {configSummary.salesToDate || '--'}
            </span>
            <span className="bg-slate-100 border border-slate-200 text-slate-700 rounded px-2 py-1 font-mono">
              🏭 {configSummary.slocCount} Sloc
            </span>
            <span className="bg-slate-100 border border-slate-200 text-slate-700 rounded px-2 py-1 font-mono">
              📦 {SAP_MODULE_LABELS[configSummary.sapTargetModule] || configSummary.sapTargetModule}
            </span>
          </div>
        </div>

        {/* Quick-action buttons grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <button
            onClick={() => handleQuickAction('DOWNLOAD_SALES')}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 text-slate-700 hover:text-blue-800 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer text-left"
          >
            <ShoppingCart className="w-4 h-4 flex-shrink-0 text-blue-500" />
            Tải Nhanh Doanh Số POS
          </button>

          <button
            onClick={() => handleQuickAction('DOWNLOAD_INVENTORY')}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-green-50 hover:border-green-200 text-slate-700 hover:text-green-800 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer text-left"
          >
            <HardDrive className="w-4 h-4 flex-shrink-0 text-green-500" />
            Tải Nhanh Tồn Kho POS
          </button>

          <button
            onClick={() => handleQuickAction('SAP_AUTOMATION', { sapTargetModule: 'PURCHASING_PO' })}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-purple-50 hover:border-purple-200 text-slate-700 hover:text-purple-800 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer text-left"
          >
            <Server className="w-4 h-4 flex-shrink-0 text-purple-500" />
            Mở SAP Đặt Hàng (PO)
          </button>

          <button
            onClick={() => handleQuickAction('SAP_AUTOMATION', { sapTargetModule: 'PURCHASING_RETURN' })}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded border border-slate-200 bg-slate-50 hover:bg-orange-50 hover:border-orange-200 text-slate-700 hover:text-orange-800 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer text-left"
          >
            <ArrowRight className="w-4 h-4 flex-shrink-0 text-orange-500" />
            Mở SAP Xuất Trả Hàng (Return)
          </button>

          <button
            onClick={handleRunDaily}
            disabled={isLoading}
            className="sm:col-span-2 lg:col-span-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4" />
            {isLoading ? 'Đang thực thi...' : 'CHẠY TOÀN BỘ QUY TRÌNH MUA HÀNG'}
          </button>
        </div>
      </div>

      {/* Modal Profile */}
      <EnterpriseProfilesModal
        isOpen={isProfilesModalOpen}
        onClose={() => setIsProfilesModalOpen(false)}
      />
    </div>
  );
}
