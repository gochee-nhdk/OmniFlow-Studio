import React, { useState, useEffect } from 'react';
import {
  Server, FolderOpen, Play, CheckCircle2, Clock, AlertTriangle,
  RefreshCw, KeyRound, Shield, Check, Building2, Eye, EyeOff
} from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { invoke } from '../lib/ipc';

const SAP_COMPANIES = [
  'CÔNG TY TNHH Thương Mại LARIA (FM_PRO)',
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

export default function SAPPage() {
  const { networkStatus, isCheckingNetwork, checkNetwork, activeProgress, isLoading, startWorkflow } = useAgentStore();
  const { getActiveProfile } = useEnterpriseStore();
  const activeProfile = getActiveProfile();

  const companyList = Array.from(new Set([
    activeProfile?.companyName,
    ...SAP_COMPANIES
  ].filter(Boolean) as string[]));

  const [sapServer, setSapServer] = useState(activeProfile?.server || 'SBO@172.16.0.201:30013');
  const [sapCompany, setSapCompany] = useState(activeProfile?.companyName || 'CÔNG TY TNHH Thương Mại LARIA (FM_PRO)');
  const [sapUser, setSapUser] = useState(() => {
    try {
      return localStorage.getItem('sap_user') || 'LOG32';
    } catch {
      return 'LOG32';
    }
  });
  const [sapPassword, setSapPassword] = useState(() => {
    try {
      return localStorage.getItem('sap_pass') || '';
    } catch {
      return '';
    }
  });
  const [showSapPassword, setShowSapPassword] = useState(false);
  const [sapDir, setSapDir] = useState(() => {
    try {
      return localStorage.getItem('sap_dir') || 'D:\\FM_AUTO_OPS\\SAP';
    } catch {
      return 'D:\\FM_AUTO_OPS\\SAP';
    }
  });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    checkNetwork();

    // Auto-load saved credentials (Username and Password) so user never has to re-type
    invoke<any>('credentials:get', { accountName: 'SAP_MAIN' }).then((res) => {
      if (res) {
        if (res.username) {
          setSapUser(res.username);
          try { localStorage.setItem('sap_user', res.username); } catch {}
        }
        if (res.password) {
          setSapPassword(res.password);
          try { localStorage.setItem('sap_pass', res.password); } catch {}
        }
      }
    }).catch(() => null);

    // Auto-load saved server, company, and directory settings
    invoke<any>('settings:get').then((res: any) => {
      const data = res?.data || res;
      if (data?.sapServer) setSapServer(data.sapServer);
      if (data?.sapCompany) setSapCompany(data.sapCompany);
      if (data?.sapDir) {
        setSapDir(data.sapDir);
        try { localStorage.setItem('sap_dir', data.sapDir); } catch {}
      } else if (data?.defaultSavePath) {
        setSapDir(`${data.defaultSavePath}\\SAP`);
      }
    }).catch(() => null);
  }, []);

  const persistCredentials = (newUser: string, newPass: string) => {
    try {
      if (newUser) localStorage.setItem('sap_user', newUser);
      if (newPass) localStorage.setItem('sap_pass', newPass);
    } catch {}

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (newUser && newPass) {
        invoke('credentials:save', {
          accountName: 'SAP_MAIN',
          username: newUser,
          password: newPass,
          application: 'SAP',
          url: 'https://172.16.1.210:8100/dispatcher/',
        }).catch(() => null);
      }
    }, 600);
  };

  const handleUserChange = (val: string) => {
    setSapUser(val);
    persistCredentials(val, sapPassword);
  };

  const handlePasswordChange = (val: string) => {
    setSapPassword(val);
    persistCredentials(sapUser, val);
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
    if (!sapUser || !sapPassword) {
      alert('Vui lòng nhập User ID và Mật khẩu SAP.');
      return;
    }
    try {
      await invoke('credentials:save', {
        accountName: 'SAP_MAIN',
        username: sapUser,
        password: sapPassword,
        application: 'SAP',
        url: 'https://172.16.1.210:8100/dispatcher/',
      });

      await invoke('settings:set', {
        sapServer,
        sapCompany,
        sapDir,
      });

      try {
        localStorage.setItem('sap_dir', sapDir);
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
        url: 'https://172.16.1.210:8100/dispatcher/',
      }).catch(() => null);

      invoke('settings:set', {
        sapServer,
        sapCompany,
      }).catch(() => null);
    }

    await startWorkflow('SAP_AUTOMATION', {
      sapServer,
      sapCompany,
      sapUser,
      sapPassword,
      sapOutputDir: sapDir,
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
            Quản lý xác thực SAP SLD &amp; Tự động hóa luồng PO &amp; Đổi trả ({activeProfile?.erpUrl || 'https://172.16.1.210:8100/dispatcher/'})
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
              ? 'SAP Server Kết nối (172.16.1.210:8100)'
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
            <h2 className="text-base font-bold text-slate-900">Cấu hình Đăng nhập SAP SLD (Tự động lưu vĩnh viễn)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cấu hình trực tiếp tại tab này — Mật khẩu được mã hóa an toàn, không cần nhập lại mỗi khi mở app
            </p>
          </div>
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
            System Landscape Directory
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <select
              value={sapCompany}
              onChange={(e) => setSapCompany(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              {companyList.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
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
                placeholder="••••••••"
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
