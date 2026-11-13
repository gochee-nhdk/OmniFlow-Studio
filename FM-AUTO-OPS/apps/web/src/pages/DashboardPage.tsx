import React, { useState, useEffect } from 'react';
import {
  Server, ShoppingCart, Monitor, HardDrive, Play, Download, Wifi, KeyRound,
  CheckCircle2, Clock, AlertTriangle, FolderOpen, Calendar, Filter, ChevronRight,
  SlidersHorizontal, CheckSquare, Square, Layers, Sparkles
} from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import StatusBadge from '../components/StatusBadge';
import { formatDistanceToNow, format, subDays, startOfMonth } from 'date-fns';
import { invoke } from '../lib/ipc';

const POS_STORES = [
  { id: 'All', name: 'Tất cả cửa hàng & Kho (All Stores)' },
  { id: 'DC01', name: 'DC01 - Nơ Trang Long (Kho trung tâm)' },
  { id: 'FM03', name: 'FM03 - Kho POS Retail FM03' },
  { id: 'FM04', name: 'FM04 - Kho POS Retail FM04' },
  { id: 'FM05', name: 'FM05 - Hai Bà Trưng' },
  { id: 'FM06', name: 'FM06 - Lê Văn Sỹ' },
  { id: 'FM08', name: 'FM08 - Quang Trung' },
  { id: 'FM09', name: 'FM09 - Phan Xích Long' },
  { id: 'FM10', name: 'FM10 - Thảo Điền' },
];

const SAP_COMPANIES = [
  'Công ty TNHH Thương Mại LARIA (FM_PRO)',
  'BEFORE_IMPORT_FROM_POS_12052025 (FM_PRO_120525)',
  'CÔNG TY TNHH REUNION FOODS (REUNION_PRO)',
  'Công ty TNHH Thương Mại LARIA (FM_CORE)',
  'DEV - Công ty TNHH Thương Mại LARIA (FM_DEV)',
  'DEV - Công ty TNHH Thương Mại LARIA (FM_DEV_01)',
  'DEV LARIA - TEST BIZZI (FM_BZ_DEV)',
  'DEV REUNION FOODS (REUNION_DEV)',
  'EINVOICE_TEST - Công ty TNHH Thương Mại LARIA (FM_EINVOICE_TEST)',
  'FARMER REBATE TEST (FM_REBATE_TEST)',
  'UAT - CTY THHH LARIA (FM_UAT)',
  'Z_TMP (FM_TMP)',
];

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
    agentStatus, networkStatus, recentRuns, activeProgress,
    isLoading, startWorkflow, loadHistory, checkNetwork, refreshStatus
  } = useAgentStore();

  // Active top tab: 'pos' | 'sap' | 'all'
  const [activeTab, setActiveTab] = useState<'pos' | 'sap' | 'all'>('pos');

  // POS Automation Options State
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [includeSales, setIncludeSales] = useState(true);
  const [includeInventory, setIncludeInventory] = useState(true);
  const [salesFromDate, setSalesFromDate] = useState(todayStr);
  const [salesToDate, setSalesToDate] = useState(todayStr);
  const [salesStore, setSalesStore] = useState('All');

  const [invStore, setInvStore] = useState('All');
  const [invSloc, setInvSloc] = useState('');
  const [invItem, setInvItem] = useState('');

  // SAP Automation Options State
  const [sapServer, setSapServer] = useState('SBO@172.16.0.201:30013');
  const [sapCompany, setSapCompany] = useState('Công ty TNHH Thương Mại LARIA (FM_PRO)');
  const [sapCheckSession, setSapCheckSession] = useState(true);
  const [sapCheckPurchasing, setSapCheckPurchasing] = useState(false);

  useEffect(() => {
    loadHistory();
    checkNetwork();
    refreshStatus();

    const timer = setInterval(() => {
      loadHistory();
      refreshStatus();
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const agentOnline = agentStatus?.isOnline ?? true;

  // Preset date helpers
  const handleSetDatePreset = (preset: 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'THIS_MONTH') => {
    const now = new Date();
    if (preset === 'TODAY') {
      const d = format(now, 'yyyy-MM-dd');
      setSalesFromDate(d);
      setSalesToDate(d);
    } else if (preset === 'YESTERDAY') {
      const d = format(subDays(now, 1), 'yyyy-MM-dd');
      setSalesFromDate(d);
      setSalesToDate(d);
    } else if (preset === 'LAST_7') {
      setSalesFromDate(format(subDays(now, 6), 'yyyy-MM-dd'));
      setSalesToDate(format(now, 'yyyy-MM-dd'));
    } else if (preset === 'THIS_MONTH') {
      setSalesFromDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setSalesToDate(format(now, 'yyyy-MM-dd'));
    }
  };

  // Run POS with customized target settings
  const handleRunPos = async () => {
    if (!includeSales && !includeInventory) {
      alert('Vui lòng chọn ít nhất 1 tính năng: Tải Data Doanh số hoặc Tải Data Tồn kho');
      return;
    }

    let type = 'POS_AUTOMATION';
    if (includeSales && !includeInventory) type = 'DOWNLOAD_SALES';
    if (!includeSales && includeInventory) type = 'DOWNLOAD_INVENTORY';

    await startWorkflow(type, {
      includeSales,
      includeInventory,
      fromDate: salesFromDate,
      toDate: salesToDate,
      storeFilter: salesStore,
      inventoryStoreFilter: invStore,
      inventorySlocFilter: invSloc,
      inventoryItemFilter: invItem,
    });
  };

  // Run SAP with customized target settings
  const handleRunSap = async () => {
    await startWorkflow('SAP_AUTOMATION', {
      sapServer,
      sapCompany,
      sapCheckSession,
      sapCheckPurchasing,
    });
  };

  // Run All-in-One Daily Procurement
  const handleRunAll = async () => {
    await startWorkflow('DAILY_PROCUREMENT', {
      includeSales: true,
      includeInventory: true,
      fromDate: salesFromDate,
      toDate: salesToDate,
      storeFilter: salesStore,
      inventoryStoreFilter: invStore,
      sapServer,
      sapCompany,
    });
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Automation Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Điều khiển tự động hóa quy trình nghiệp vụ Procurement &amp; Inventory</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => checkNetwork()}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg font-medium cursor-pointer shadow-2xs"
          >
            <Wifi className="w-3.5 h-3.5 text-blue-500" />
            Kiểm tra kết nối mạng
          </button>
        </div>
      </div>

      {/* Top Status Cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* POS Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
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
            <StatusBadge status={agentStatus ? getAuthStateBadge(agentStatus.posAuthState) : 'unknown'} />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {networkStatus.pos ? 'Kết nối mạng nội bộ sẵn sàng' : 'Không tìm thấy máy chủ'}
          </div>
        </div>

        {/* SAP Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                <Server className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">SAP B1 Web</div>
                <div className="text-xs text-slate-400">172.16.1.210:8100</div>
              </div>
            </div>
            <StatusBadge status={agentStatus ? getAuthStateBadge(agentStatus.sapAuthState) : 'unknown'} />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {networkStatus.sap ? 'Cổng kết nối SAP sẵn sàng' : 'Không tìm thấy máy chủ'}
          </div>
        </div>

        {/* Local Agent Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
                <Monitor className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">Local RPA Agent</div>
                <div className="text-xs text-slate-400">{agentStatus?.version ?? '1.0.0-windows'}</div>
              </div>
            </div>
            <StatusBadge status={agentOnline ? 'online' : 'offline'} />
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {agentOnline ? 'Engine Chromium v1254 sẵn sàng' : 'Agent offline'}
          </div>
        </div>

        {/* Storage Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs">
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
            <button
              onClick={() => invoke('files:open-dir', { path: 'D:\\FM_AUTO_OPS' })}
              className="text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded flex items-center gap-1 border border-amber-200 cursor-pointer transition-colors"
              title="Mở thư mục lưu trữ"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Mở
            </button>
          </div>
          <div className="mt-3 text-xs text-slate-500">Sales, Inventory, SAP, Logs</div>
        </div>
      </div>

      {/* Live Active Progress Card */}
      {activeProgress && (
        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-xs transition-all ${
          activeProgress.status === 'RUNNING'
            ? 'bg-blue-50 border-blue-200 text-blue-900'
            : activeProgress.status === 'SUCCESS'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-red-50 border-red-200 text-red-900'
        }`}>
          <div className="flex items-center gap-3">
            {activeProgress.status === 'RUNNING' ? (
              <Clock className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
            ) : activeProgress.status === 'SUCCESS' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
            )}
            <div>
              <div className="text-sm font-bold">
                {activeProgress.status === 'RUNNING' ? 'Đang thực thi RPA Automation...' : activeProgress.status === 'SUCCESS' ? 'RPA Automation Thành Công!' : 'RPA Automation Gặp Lỗi'}
              </div>
              <div className="text-xs opacity-90">{activeProgress.stepName}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => invoke('files:open-dir', { path: 'D:\\FM_AUTO_OPS\\Sales' })}
              className="text-xs bg-white/80 hover:bg-white text-slate-800 font-medium px-2.5 py-1.5 rounded border border-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Mở D:\FM_AUTO_OPS\Sales
            </button>
          </div>
        </div>
      )}

      {/* 2 SEPARATE DEDICATED TABS: POS vs SAP */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Tab Headers */}
        <div className="flex border-b border-slate-200 bg-slate-50/70 p-2 gap-2">
          <button
            onClick={() => setActiveTab('pos')}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeTab === 'pos'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>1. POS RPFO AUTOMATION</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'pos' ? 'bg-purple-700 text-purple-100' : 'bg-slate-200 text-slate-600'}`}>
              Bán hàng &amp; Tồn kho
            </span>
          </button>

          <button
            onClick={() => setActiveTab('sap')}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer ${
              activeTab === 'sap'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>2. SAP BUSINESS ONE AUTOMATION</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'sap' ? 'bg-blue-700 text-blue-100' : 'bg-slate-200 text-slate-600'}`}>
              SLD &amp; Purchasing
            </span>
          </button>

          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-xl font-bold text-sm transition-all cursor-pointer ml-auto ${
              activeTab === 'all'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>3. CHẠY TOÀN TRÌNH (ALL-IN-ONE)</span>
          </button>
        </div>

        {/* TAB 1: POS RPFO AUTOMATION CONTENT */}
        {activeTab === 'pos' && (
          <div className="p-7 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-purple-600" />
                  Cấu hình Mục tiêu Lấy Dữ liệu POS RPFO
                </h2>
                <p className="text-slate-500 text-xs mt-1">
                  Chọn loại dữ liệu muốn tải và tùy chỉnh bộ lọc chi tiết trước khi kích hoạt automation.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => invoke('files:open-dir', { path: 'D:\\FM_AUTO_OPS\\Sales' })}
                  className="flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer font-medium"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-purple-500" />
                  Thư mục Sales
                </button>
                <button
                  onClick={() => invoke('files:open-dir', { path: 'D:\\FM_AUTO_OPS\\Inventory' })}
                  className="flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer font-medium"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-purple-500" />
                  Thư mục Inventory
                </button>
              </div>
            </div>

            {/* SELECTION SECTIONS: 2 CARDS FOR SALES & INVENTORY */}
            <div className="grid grid-cols-2 gap-6">
              {/* CARD 1: SALES TRANSACTION DETAIL */}
              <div className={`rounded-xl border p-5 transition-all space-y-4 ${
                includeSales ? 'bg-purple-50/40 border-purple-200 shadow-xs' : 'bg-slate-50/60 border-slate-200 opacity-70'
              }`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2.5 font-bold text-slate-900 cursor-pointer select-none text-sm">
                    <input
                      type="checkbox"
                      checked={includeSales}
                      onChange={(e) => setIncludeSales(e.target.checked)}
                      className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
                    />
                    <span>1. Tải Dữ liệu Bán hàng (Sales Transaction Detail)</span>
                  </label>
                  <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-semibold">
                    Sales Detail
                  </span>
                </div>

                <p className="text-xs text-slate-500">
                  Tải chi tiết từng dòng hóa đơn giao dịch, khách hàng, số lượng, giảm giá, thành tiền vào <code>D:\FM_AUTO_OPS\Sales\</code>.
                </p>

                {/* Date Controls (only active when includeSales is true) */}
                <div className={`space-y-3 pt-2 ${!includeSales && 'pointer-events-none opacity-40'}`}>
                  {/* Quick Preset Buttons */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1.5">Chọn khoảng thời gian nhanh:</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSetDatePreset('TODAY')}
                        className="text-xs py-1.5 px-2 bg-white hover:bg-purple-100/60 border border-slate-200 rounded text-slate-700 font-medium cursor-pointer transition-colors"
                      >
                        Hôm nay
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetDatePreset('YESTERDAY')}
                        className="text-xs py-1.5 px-2 bg-white hover:bg-purple-100/60 border border-slate-200 rounded text-slate-700 font-medium cursor-pointer transition-colors"
                      >
                        Hôm qua
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetDatePreset('LAST_7')}
                        className="text-xs py-1.5 px-2 bg-white hover:bg-purple-100/60 border border-slate-200 rounded text-slate-700 font-medium cursor-pointer transition-colors"
                      >
                        7 ngày qua
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetDatePreset('THIS_MONTH')}
                        className="text-xs py-1.5 px-2 bg-white hover:bg-purple-100/60 border border-slate-200 rounded text-slate-700 font-medium cursor-pointer transition-colors"
                      >
                        Tháng này
                      </button>
                    </div>
                  </div>

                  {/* Date Pickers */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        Từ ngày (From Date):
                      </label>
                      <div className="relative">
                        <input
                          type="date"
                          value={salesFromDate}
                          onChange={(e) => setSalesFromDate(e.target.value)}
                          className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1">
                        Đến ngày (To Date):
                      </label>
                      <div className="relative">
                        <input
                          type="date"
                          value={salesToDate}
                          onChange={(e) => setSalesToDate(e.target.value)}
                          className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Store Filter */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Lọc theo Cửa hàng (Store):
                    </label>
                    <select
                      value={salesStore}
                      onChange={(e) => setSalesStore(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                    >
                      {POS_STORES.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* CARD 2: INVENTORY ONHAND */}
              <div className={`rounded-xl border p-5 transition-all space-y-4 ${
                includeInventory ? 'bg-purple-50/40 border-purple-200 shadow-xs' : 'bg-slate-50/60 border-slate-200 opacity-70'
              }`}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2.5 font-bold text-slate-900 cursor-pointer select-none text-sm">
                    <input
                      type="checkbox"
                      checked={includeInventory}
                      onChange={(e) => setIncludeInventory(e.target.checked)}
                      className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
                    />
                    <span>2. Tải Dữ liệu Tồn kho (Inventory Onhand)</span>
                  </label>
                  <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-semibold">
                    Inventory
                  </span>
                </div>

                <p className="text-xs text-slate-500">
                  Tải số lượng tồn kho theo thời gian thực (Quantity, BeginQty, InQty, OutQty, EndQty) vào <code>D:\FM_AUTO_OPS\Inventory\</code>.
                </p>

                {/* Inventory Filter Controls */}
                <div className={`space-y-3 pt-2 ${!includeInventory && 'pointer-events-none opacity-40'}`}>
                  {/* Store Filter */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Lọc theo Kho / Cửa hàng:
                    </label>
                    <select
                      value={invStore}
                      onChange={(e) => setInvStore(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                    >
                      {POS_STORES.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Sloc Id filter */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Mã vị trí kho (Sloc Id / Whs Name):
                    </label>
                    <input
                      type="text"
                      placeholder="VD: SDC0101, SFM0502 (để trống = lấy tất cả)"
                      value={invSloc}
                      onChange={(e) => setInvSloc(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {/* Item filter */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Mã hoặc Tên Sản phẩm (Item Code / Name):
                    </label>
                    <input
                      type="text"
                      placeholder="VD: B0000001, Hạt dẻ... (để trống = lấy tất cả)"
                      value={invItem}
                      onChange={(e) => setInvItem(e.target.value)}
                      className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="bg-slate-900 rounded-xl p-5 flex items-center justify-between shadow-md">
              <div className="text-white space-y-1">
                <div className="text-xs text-purple-300 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Mục tiêu thực thi đã chọn:
                </div>
                <div className="text-sm font-medium">
                  {includeSales && includeInventory ? (
                    <span>Tải cả <strong>Sales ({salesFromDate} → {salesToDate})</strong> &amp; <strong>Tồn kho ({invStore})</strong></span>
                  ) : includeSales ? (
                    <span>Chỉ tải <strong>Sales Transaction Detail ({salesFromDate} → {salesToDate})</strong></span>
                  ) : includeInventory ? (
                    <span>Chỉ tải <strong>Inventory Onhand ({invStore})</strong></span>
                  ) : (
                    <span className="text-amber-400">Chưa chọn tính năng nào để chạy</span>
                  )}
                </div>
              </div>

              <button
                onClick={handleRunPos}
                disabled={isLoading || (!includeSales && !includeInventory)}
                className="flex items-center gap-2.5 bg-purple-600 hover:bg-purple-500 active:scale-98 disabled:bg-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm py-3 px-6 rounded-xl transition-all shadow-md cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                CHẠY POS AUTOMATION THEO CẤU HÌNH
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: SAP BUSINESS ONE AUTOMATION CONTENT */}
        {activeTab === 'sap' && (
          <div className="p-7 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-600" />
                  Cấu hình Tự động hóa SAP Business One
                </h2>
                <p className="text-slate-500 text-xs mt-1">
                  Đăng nhập System Landscape Directory (SLD), quản lý phiên an toàn và chuẩn bị quy trình mua hàng.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => checkNetwork()}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer font-medium"
                >
                  <Wifi className="w-3.5 h-3.5 text-blue-500" />
                  Kiểm tra Kết nối SAP
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* SAP TARGET CONFIGURATION */}
              <div className="bg-blue-50/40 border border-blue-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-600" />
                  Thông số Đăng nhập SLD SAP
                </h3>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Máy chủ SAP SLD (Server):
                  </label>
                  <input
                    type="text"
                    value={sapServer}
                    onChange={(e) => setSapServer(e.target.value)}
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Cơ sở dữ liệu Công ty (Company Database):
                  </label>
                  <select
                    value={sapCompany}
                    onChange={(e) => setSapCompany(e.target.value)}
                    className="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    {SAP_COMPANIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    Chính sách An toàn Phiên làm việc (Zero Displace):
                  </div>
                  <div>
                    Khi phát hiện tài khoản đang được đăng nhập ở nơi khác, hệ thống sẽ <strong>tạm dừng và hỏi xác nhận</strong>, tuyệt đối không tự động logout người dùng khác.
                  </div>
                </div>
              </div>

              {/* SAP OPERATIONS */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Tính năng Automation SAP</h3>

                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sapCheckSession}
                      onChange={(e) => setSapCheckSession(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800">Tự động Mở trình duyệt &amp; Đăng nhập SAP SLD</div>
                      <div className="text-xs text-slate-500">Mở dispatcher, chọn Server, chọn Company DB, điền User &amp; Password, kiểm tra phiên.</div>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 bg-white border border-slate-200 rounded-lg opacity-75 cursor-not-allowed">
                    <input
                      type="checkbox"
                      disabled
                      checked={sapCheckPurchasing}
                      onChange={(e) => setSapCheckPurchasing(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-slate-300 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>Điều hướng Module Purchasing - A/P</span>
                        <span className="text-2xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">Phase 4</span>
                      </div>
                      <div className="text-xs text-slate-500">Mở phân hệ Mua hàng, tra cứu Purchase Order và Return.</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="bg-slate-900 rounded-xl p-5 flex items-center justify-between shadow-md">
              <div className="text-white space-y-1">
                <div className="text-xs text-blue-300 font-semibold uppercase tracking-wider">
                  Mục tiêu thực thi SAP:
                </div>
                <div className="text-sm font-medium">
                  Đăng nhập vào: <strong>{sapCompany}</strong>
                </div>
              </div>

              <button
                onClick={handleRunSap}
                disabled={isLoading}
                className="flex items-center gap-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 disabled:bg-slate-800 disabled:cursor-not-allowed text-white font-bold text-sm py-3 px-6 rounded-xl transition-all shadow-md cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                CHẠY SAP AUTOMATION (RUN SAP)
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: ALL-IN-ONE DAILY PROCUREMENT */}
        {activeTab === 'all' && (
          <div className="p-7 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                Quy trình Chuẩn: Chạy Toàn Bộ Mua Hàng Hằng Ngày (One Click)
              </h2>
              <p className="text-slate-500 text-xs mt-1">
                Tự động hóa đồng thời cả POS RPFO (Bán hàng + Tồn kho) và SAP Business One trong một chu trình duy nhất.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="text-xs font-bold text-purple-700 uppercase">Bước 1: POS Sales</div>
                <div className="text-xs text-slate-600">Tải Sales Transaction Detail ({salesFromDate} → {salesToDate})</div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="text-xs font-bold text-purple-700 uppercase">Bước 2: POS Inventory</div>
                <div className="text-xs text-slate-600">Tải Inventory Onhand ({invStore})</div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="text-xs font-bold text-blue-700 uppercase">Bước 3: SAP B1</div>
                <div className="text-xs text-slate-600">Xác thực SLD &amp; Đồng bộ dữ liệu</div>
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl p-6 flex items-center justify-between shadow-md">
              <div className="text-white space-y-1">
                <div className="text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  ALL-IN-ONE AUTOMATION
                </div>
                <div className="text-base font-bold">Chạy toàn bộ quy trình mua hàng chỉ với 1 click duy nhất</div>
              </div>

              <button
                onClick={handleRunAll}
                disabled={isLoading}
                className="flex items-center gap-3 bg-emerald-500 hover:bg-emerald-400 active:scale-98 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-bold text-base py-3.5 px-7 rounded-xl transition-all shadow-lg cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                RUN DAILY PROCUREMENT
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Recent runs table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Workflow Runs</h2>
            <span className="text-xs text-slate-400 font-mono">SQLite Local DB</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => invoke('files:open-dir', { path: 'D:\\FM_AUTO_OPS\\Sales' })}
              className="text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer flex items-center gap-1 font-medium"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Mở D:\FM_AUTO_OPS
            </button>
          </div>
        </div>

        {recentRuns.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Chưa có lượt chạy nào được ghi nhận. Hãy kích hoạt automation ở các tab phía trên.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100">
                <th className="px-6 py-3 text-left font-medium">Workflow</th>
                <th className="px-6 py-3 text-left font-medium">Bắt đầu</th>
                <th className="px-6 py-3 text-left font-medium">Thời gian chạy</th>
                <th className="px-6 py-3 text-left font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentRuns.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-medium text-slate-900">{run.workflowType}</td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-xs font-mono">
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
