import React, { useState, useEffect } from 'react';
import {
  Server, FolderOpen, Play, CheckCircle2, Clock, AlertTriangle,
  RefreshCw, KeyRound, Shield, Check, Building2, Eye, EyeOff, Globe, ExternalLink
} from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { invoke } from '../lib/ipc';

const SAP_COMPANIES = [
  'ACME Global Retail Corp (ACME_ERP)',
  'Standard Enterprise Retail Group (STANDARD_ERP)',
  'DEMO Organization (DEMO_ORG)',
  'DEV - Enterprise Testing (DEV_01)',
  'UAT - Enterprise Validation (UAT_CORE)',
];

export default function SAPPage() {
  const { networkStatus, isCheckingNetwork, checkNetwork, activeProgress, isLoading, startWorkflow } = useAgentStore();
  const { getActiveProfile } = useEnterpriseStore();
  const activeProfile = getActiveProfile();

  const companyList = Array.from(new Set([
    activeProfile?.companyName,
    ...SAP_COMPANIES
  ].filter(Boolean) as string[]));

  const [sapUrl, setSapUrl] = useState(() => {
    try {
      const saved = localStorage.getItem('sap_url');
      if (saved && saved.trim()) return saved.trim();
      return '';
    } catch {
      return '';
    }
  });
  const [sapServer, setSapServer] = useState(activeProfile?.server || 'SBO@sap-cluster.enterprise.example.com:30013');
  const [sapCompany, setSapCompany] = useState(activeProfile?.companyName || 'ACME Global Retail Corp (ACME_ERP)');
  const [sapUser, setSapUser] = useState(() => {
    try {
      return localStorage.getItem('sap_user') || 'ERP_USER';
    } catch {
      return 'ERP_USER';
    }
  });
  const [sapPassword, setSapPassword] = useState('');
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [showSapPassword, setShowSapPassword] = useState(false);
  const [testingSapUrl, setTestingSapUrl] = useState(false);
  const [sapUrlTestResult, setSapUrlTestResult] = useState<{ ok?: boolean; msg?: string } | null>(null);
  const [sapDir, setSapDir] = useState(() => {
    try {
      return localStorage.getItem('sap_dir') || 'D:\\FM_AUTO_OPS\\SAP';
    } catch {
      return 'D:\\FM_AUTO_OPS\\SAP';
    }
  });
  const [autoTakeOverSession, setAutoTakeOverSession] = useState(() => {
    try {
      const stored = localStorage.getItem('sap_auto_takeover');
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });
  const [sapTargetModule, setSapTargetModule] = useState<'HOME' | 'PURCHASING_PO' | 'PURCHASING_GRPO' | 'PURCHASING_RETURN'>(() => (localStorage.getItem('sap_target_module') as any) || 'HOME');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    checkNetwork();

    // Auto-load saved credentials (Username and Password state) without exposing raw secret to localStorage
    invoke<any>('credentials:get', { accountName: 'SAP_MAIN' }).then((res) => {
      if (res) {
        if (res.username) {
          setSapUser(res.username);
          try { localStorage.setItem('sap_user', res.username); } catch {}
        }
        if (res.url && res.url.trim()) {
          setSapUrl(res.url);
          try { localStorage.setItem('sap_url', res.url); } catch {}
        }
        if (res.hasPassword) {
          setHasSavedPassword(true);
        }
      }
    }).catch(() => null);

    // Auto-load saved server, company, and directory settings
    invoke<any>('settings:get').then((res: any) => {
      const data = res?.data || res;
      if (data?.sapUrl) {
        setSapUrl(data.sapUrl);
        try { localStorage.setItem('sap_url', data.sapUrl); } catch {}
      }
      if (data?.sapServer) setSapServer(data.sapServer);
      if (data?.sapCompany) setSapCompany(data.sapCompany);
      if (data?.sapTargetModule) setSapTargetModule(data.sapTargetModule);
      if (data?.sapAutoTakeOverSession !== undefined) {
        setAutoTakeOverSession(data.sapAutoTakeOverSession);
        try { localStorage.setItem('sap_auto_takeover', JSON.stringify(data.sapAutoTakeOverSession)); } catch {}
      }
      if (data?.sapDir) {
        setSapDir(data.sapDir);
        try { localStorage.setItem('sap_dir', data.sapDir); } catch {}
      } else if (data?.defaultSavePath) {
        setSapDir(`${data.defaultSavePath}\\SAP`);
      }
    }).catch(() => null);
  }, []);

  const handleSapUrlChange = (val: string) => {
    setSapUrl(val);
    setSapUrlTestResult(null);
    try { localStorage.setItem('sap_url', val); } catch {}
    invoke('settings:set', { sapUrl: val }).catch(() => null);
  };

  const handleTestSapUrl = async () => {
    if (!sapUrl) return;
    setTestingSapUrl(true);
    setSapUrlTestResult(null);
    try {
      const res = await invoke<{ reachable: boolean; message?: string }>('credentials:test', { url: sapUrl });
      if (res?.reachable) {
        setSapUrlTestResult({ ok: true, msg: 'Kết nối máy chủ SAP SLD thành công!' });
      } else {
        setSapUrlTestResult({ ok: false, msg: res?.message || 'Không thể kết nối tới URL SAP.' });
      }
    } catch (err: any) {
      setSapUrlTestResult({ ok: false, msg: err?.message || 'Lỗi kiểm tra kết nối' });
    } finally {
      setTestingSapUrl(false);
    }
  };

  const persistCredentials = (newUser: string, newPass: string, newUrl: string = sapUrl) => {
    try {
      if (newUser) localStorage.setItem('sap_user', newUser);
    } catch {}

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (newUser && newPass) {
        invoke('credentials:save', {
          accountName: 'SAP_MAIN',
          username: newUser,
          password: newPass,
          application: 'SAP',
          url: newUrl || activeProfile?.erpUrl || 'https://erp.enterprise.example.com:8100/dispatcher/',
        }).then(() => setHasSavedPassword(true)).catch(() => null);
      }
    }, 600);
  };

  const handleUserChange = (val: string) => {
    setSapUser(val);
    persistCredentials(val, sapPassword, sapUrl);
  };

  const handlePasswordChange = (val: string) => {
    setSapPassword(val);
    persistCredentials(sapUser, val, sapUrl);
  };

  const handleSapDirChange = (val: string) => {
    setSapDir(val);
    try { localStorage.setItem('sap_dir', val); } catch {}
    invoke('settings:set', { sapDir: val }).catch(() => null);
  };

  const handlePickSapDir = async () => {
    try {
      const selected = await invoke<string | null>('dialog:open-directory', sapDir);
      if (selected) {
        handleSapDirChange(selected);
      }
    } catch {
      // Fallback
    }
  };

  const handleSaveCredentials = async () => {
    if (!sapUser || (!sapPassword && !hasSavedPassword)) {
      alert('Vui lòng nhập User ID và Mật khẩu SAP.');
      return;
    }
    try {
      if (sapPassword) {
        await invoke('credentials:save', {
          accountName: 'SAP_MAIN',
          username: sapUser,
          password: sapPassword,
          application: 'SAP',
          url: sapUrl || activeProfile?.erpUrl || 'https://erp.enterprise.example.com:8100/dispatcher/',
        });
        setHasSavedPassword(true);
      }

      await invoke('settings:set', {
        sapUrl,
        sapServer,
        sapCompany,
        sapDir,
        sapAutoTakeOverSession: autoTakeOverSession,
        sapTargetModule,
      });

      try {
        localStorage.setItem('sap_url', sapUrl);
        localStorage.setItem('sap_dir', sapDir);
        localStorage.setItem('sap_auto_takeover', JSON.stringify(autoTakeOverSession));
      } catch {}

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      alert('Lỗi lưu cấu hình: ' + e.message);
    }
  };

  const handleRunSapAuth = async () => {
    if (sapUser && sapPassword) {
      invoke('credentials:save', {
        accountName: 'SAP_MAIN',
        username: sapUser,
        password: sapPassword,
        application: 'SAP',
        url: sapUrl || activeProfile?.erpUrl || 'https://erp.enterprise.example.com:8100/dispatcher/',
      }).then(() => setHasSavedPassword(true)).catch(() => null);

      invoke('settings:set', {
        sapUrl,
        sapServer,
        sapCompany,
        sapAutoTakeOverSession: autoTakeOverSession,
      }).catch(() => null);
    }

    await startWorkflow('SAP_AUTOMATION', {
      sapUrl,
      sapBaseUrl: sapUrl,
      sapServer,
      sapCompany,
      sapUser,
      sapPassword: sapPassword || undefined,
      sapOutputDir: sapDir,
      sapAutoTakeOverSession: autoTakeOverSession,
      sapTargetModule,
    });
  };

  const openFolder = (path: string) => {
    invoke('files:open-dir', { path }).catch(() => null);
  };

  const isSapOnline = networkStatus?.sap ?? true;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              {activeProfile?.code || 'DEFAULT'}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {activeProfile?.name}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Server className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">SAP Business One Automation</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Quản lý xác thực SAP SLD &amp; Tự động hóa luồng PO &amp; Đổi trả ({sapUrl || activeProfile?.erpUrl || 'https://erp.enterprise.example.com:8100/dispatcher/'})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
            isCheckingNetwork
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : isSapOnline
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              isCheckingNetwork
                ? 'bg-blue-500 animate-pulse'
                : isSapOnline
                ? 'bg-emerald-500'
                : 'bg-red-500'
            }`} />
            {isCheckingNetwork
              ? 'Đang kiểm tra kết nối...'
              : isSapOnline
              ? `SAP Server Kết nối (${(() => {
                  try {
                    return new URL(sapUrl || activeProfile?.erpUrl || 'https://erp.enterprise.example.com:8100').host;
                  } catch {
                    return sapUrl;
                  }
                })()})`
              : 'SAP Mất kết nối'}
          </div>
          <button
            onClick={() => checkNetwork({ showFeedback: true })}
            disabled={isCheckingNetwork}
            className={`p-1.5 rounded border border-slate-200 transition-colors ${
              isCheckingNetwork
                ? 'text-blue-600 bg-blue-50 cursor-wait'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer'
            }`}
            title="Kiểm tra lại kết nối SAP"
          >
            <RefreshCw className={`w-4 h-4 ${isCheckingNetwork ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main SAP Config Panel */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Thiết lập Kết nối &amp; Đăng nhập SAP SLD (Tự động lưu vĩnh viễn)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cấu hình đường dẫn Dispatcher / Web Client SLD và tài khoản SAP — Mật khẩu được mã hóa an toàn, tự động lưu vĩnh viễn
            </p>
          </div>
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
            System Landscape Directory
          </span>
        </div>

        {/* Initial Entry URL / Dispatcher SLD Setup */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-600" />
              Đường dẫn Dispatcher / Web Client SLD (SAP URL)
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              {sapUrl ? 'Đã cấu hình' : 'Chưa thiết lập'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={sapUrl}
              onChange={(e) => handleSapUrlChange(e.target.value)}
              placeholder="VD: https://172.16.1.210:8100/dispatcher/ hoặc https://erp.yourdomain.local:8100/dispatcher/"
              className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono text-slate-800"
            />
            <button
              type="button"
              onClick={handleTestSapUrl}
              disabled={testingSapUrl || !sapUrl}
              className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title="Kiểm tra kết nối trực tiếp đến URL này"
            >
              {testingSapUrl ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              )}
              {testingSapUrl ? 'Đang kiểm tra...' : 'Kiểm tra URL'}
            </button>
          </div>
          {sapUrlTestResult && (
            <div className={`text-xs px-2.5 py-1 rounded flex items-center gap-1.5 mt-1 ${
              sapUrlTestResult.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {sapUrlTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
              <span>{sapUrlTestResult.msg}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Server (#sbo_dbserver)
            </label>
            <input
              type="text"
              value={sapServer}
              onChange={(e) => setSapServer(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Company Database (#sbo_company)
            </label>
            <input
              list="sap-companies-datalist"
              value={sapCompany}
              onChange={(e) => { setSapCompany(e.target.value); invoke('settings:set', { sapCompany: e.target.value }).catch(() => null); }}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <datalist id="sap-companies-datalist">
              {companyList.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </datalist>
            <label htmlFor="sap-target-module" className="text-xs font-medium text-slate-600 block mt-3 mb-1">Màn hình nghiệp vụ mở sẵn sau đăng nhập</label>
            <select id="sap-target-module" value={sapTargetModule} onChange={(e) => {
              const value = e.target.value as typeof sapTargetModule;
              setSapTargetModule(value);
              try { localStorage.setItem('sap_target_module', value); } catch {}
              invoke('settings:set', { sapTargetModule: value }).catch(() => null);
            }} className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded">
              <option value="HOME">Trang chủ SAP</option><option value="PURCHASING_PO">Đơn mua hàng (Purchase Order)</option>
              <option value="PURCHASING_GRPO">Nhập kho (Goods Receipt PO)</option><option value="PURCHASING_RETURN">Trả hàng (Goods Return)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              User ID (#sbo_user)
            </label>
            <input
              type="text"
              value={sapUser}
              onChange={(e) => handleUserChange(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Password (#sbo_password)
            </label>
            <div className="relative">
              <input
                type={showSapPassword ? 'text' : 'password'}
                value={sapPassword}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder={hasSavedPassword ? '•••••••• (Đã lưu an toàn)' : '••••••••'}
                className="w-full pl-3 pr-9 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowSapPassword(!showSapPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                title={showSapPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showSapPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Directory selection */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">
            Thư mục lưu trữ tài liệu SAP (Tự động lưu)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={sapDir}
              onChange={(e) => handleSapDirChange(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded bg-slate-50 font-mono text-slate-700"
            />
            <button
              type="button"
              onClick={handlePickSapDir}
              className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded cursor-pointer whitespace-nowrap"
            >
              Chọn...
            </button>
            <button
              type="button"
              onClick={() => openFolder(sapDir)}
              className="p-2 text-slate-500 hover:text-slate-700 border border-slate-300 rounded hover:bg-slate-100"
              title="Mở thư mục"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Take Over Session Setting */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <label htmlFor="sap-takeover-toggle" className="text-xs font-semibold text-slate-800 cursor-pointer flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Tự động chiếm phiên làm việc (Take Over Session)
              </label>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Khi được bật, hệ thống sẽ tự động xác nhận hộp thoại cảnh báo xung đột tài khoản để tiếp tục đăng nhập.
                Nếu tắt, hệ thống sẽ dừng lại cảnh báo để bảo vệ dữ liệu đang nhập của người dùng khác và tuân thủ quy định tài khoản.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-0.5">
              <input
                id="sap-takeover-toggle"
                type="checkbox"
                checked={autoTakeOverSession}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoTakeOverSession(val);
                  try { localStorage.setItem('sap_auto_takeover', JSON.stringify(val)); } catch {}
                  invoke('settings:set', { sapAutoTakeOverSession: val }).catch(() => null);
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        {/* Save credentials button & status */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Shield className="w-4 h-4 text-emerald-600" />
            Lưu an toàn vào máy — Sẵn sàng cho mọi phiên tự động hóa
          </div>

          <button
            type="button"
            onClick={handleSaveCredentials}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-900 text-white rounded transition-colors cursor-pointer"
          >
            {saveSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <KeyRound className="w-3.5 h-3.5" />}
            {saveSuccess ? 'Đã lưu cấu hình vĩnh viễn' : 'Lưu cấu hình SAP'}
          </button>
        </div>
      </div>

      {/* Action Box */}
      <div className="bg-slate-900 rounded-lg p-5 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white">Kiểm tra kết nối & Đăng nhập SAP</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            Tự động mở trình duyệt Chromium độc lập cho SAP, điền biểu mẫu SLD và kiểm tra trạng thái phiên làm việc
          </p>
        </div>
        <button
          type="button"
          disabled={isLoading}
          onClick={handleRunSapAuth}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-bold text-sm px-5 py-2.5 rounded shadow transition-colors cursor-pointer whitespace-nowrap"
        >
          <Play className="w-4 h-4 fill-current" />
          Đăng nhập & Kiểm tra SAP
        </button>
      </div>

      {/* Live Execution Progress Box */}
      {activeProgress && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 text-blue-600 ${activeProgress.status === 'RUNNING' ? 'animate-spin' : ''}`} />
              Tiến trình thực thi SAP Automation
            </h3>
            <span className={`text-xs px-2.5 py-0.5 rounded font-semibold ${
              activeProgress.status === 'RUNNING' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
              activeProgress.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {activeProgress.status === 'RUNNING' ? 'Đang thực hiện...' : activeProgress.status === 'SUCCESS' ? 'Hoàn thành' : 'Thất bại'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded border border-slate-200 text-sm font-medium text-slate-800 flex items-center gap-2">
            {activeProgress.status === 'SUCCESS' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : activeProgress.status === 'FAILED' ? (
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
            ) : (
              <Clock className="w-4 h-4 text-blue-600 flex-shrink-0 animate-pulse" />
            )}
            <span>{activeProgress.stepName}</span>
          </div>

          {activeProgress.errorMessage && (
            <div className="p-3 bg-red-50 text-red-800 rounded text-xs border border-red-200">
              {activeProgress.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
