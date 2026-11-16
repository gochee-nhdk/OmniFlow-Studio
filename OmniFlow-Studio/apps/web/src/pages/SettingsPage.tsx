import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, Shield, ExternalLink, Building2, Plus, Check, Edit3, Sparkles, RefreshCw, CheckCircle2, XCircle, AlertCircle, Clock, Lock, Download, Upload, ShieldCheck, KeyRound, AlertTriangle, FileArchive, X } from 'lucide-react';
import { invoke } from '../lib/ipc';
import { useEnterpriseStore } from '../store/enterpriseStore';
import EnterpriseProfilesModal from '../components/EnterpriseProfilesModal';

interface EndpointProbeResult {
  id: string;
  name: string;
  url: string;
  port: number;
  reachable?: boolean;
  latencyMs?: number;
  statusCode?: number;
  error?: string;
  isChecking?: boolean;
}

const DEFAULT_SERVICES = [
  { id: 'sap-web', name: 'SAP Business One Web Client', url: '', port: 8100 },
  { id: 'sap-sld', name: 'SAP System Landscape Directory (SLD)', url: '', port: 40000 },
  { id: 'pos-web', name: 'POS RPFO Web Application', url: '', port: 80 },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'storage' | 'network' | 'enterprise' | 'vault'>('storage');
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);
  const { profiles, activeProfileId, setActiveProfile } = useEnterpriseStore();
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);
  const [defaultReportRoot, setDefaultReportRoot] = useState('');
  const reportRoot = activeProfile?.exportPath || defaultReportRoot;

  // Real-time network probe state
  const [services, setServices] = useState<EndpointProbeResult[]>(
    DEFAULT_SERVICES.map((s) => ({ ...s, isChecking: false }))
  );
  const [isProbingAll, setIsProbingAll] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ documents?: string }>('app:get-paths').then((paths) => {
      if (paths?.documents) setDefaultReportRoot(`${paths.documents}\\OmniFlow_Reports`);
    }).catch(() => null);
    invoke<any>('settings:get').then((settings: any) => {
      const data = settings?.data || settings || {};
      setServices([
        { ...DEFAULT_SERVICES[0], url: activeProfile?.erpUrl || data.sapUrl || '' },
        { ...DEFAULT_SERVICES[1], url: data.sapSldUrl || '' },
        { ...DEFAULT_SERVICES[2], url: activeProfile?.posUrl || data.posBaseUrl || data.posUrl || '' },
      ].map((service) => ({ ...service, isChecking: false })));
    }).catch(() => {
      setServices([
        { ...DEFAULT_SERVICES[0], url: activeProfile?.erpUrl || '' },
        DEFAULT_SERVICES[1],
        { ...DEFAULT_SERVICES[2], url: activeProfile?.posUrl || '' },
      ].map((service) => ({ ...service, isChecking: false })));
    });
  }, [activeProfile?.id]);

  const runNetworkProbe = useCallback(async () => {
    setIsProbingAll(true);
    const configuredServices = services.filter((service) => service.url.trim());
    if (configuredServices.length === 0) {
      setServices((prev) => prev.map((service) => ({ ...service, reachable: false, error: 'Chưa cấu hình URL', isChecking: false })));
      setIsProbingAll(false);
      return;
    }
    setServices((prev) => prev.map((s) => ({ ...s, isChecking: Boolean(s.url.trim()), error: s.url.trim() ? undefined : 'Chưa cấu hình URL' })));

    try {
      const response = await invoke<{
        results: Array<{
          id: string;
          url: string;
          port: number;
          reachable: boolean;
          latencyMs: number;
          statusCode?: number;
          error?: string;
        }>;
        checkedAt: string;
      }>('network:probe-endpoints', configuredServices);

      if (response && response.results) {
        setServices((prev) =>
          prev.map((s) => {
            const probe = response.results.find((r) => r.id === s.id);
            if (probe) {
              return {
                ...s,
                reachable: probe.reachable,
                latencyMs: probe.latencyMs,
                statusCode: probe.statusCode,
                error: probe.error,
                isChecking: false,
              };
            }
            return { ...s, isChecking: false, error: s.url.trim() ? undefined : 'Chưa cấu hình URL' };
          })
        );
        const timeStr = new Date(response.checkedAt || Date.now()).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setLastCheckedAt(timeStr);
      }
    } catch (err) {
      console.error('Failed to probe endpoints:', err);
      setServices((prev) =>
        prev.map((s) => ({
          ...s,
          reachable: false,
          error: (err as Error).message || 'Lỗi IPC khi thăm dò cổng kết nối',
          isChecking: false,
        }))
      );
    } finally {
      setIsProbingAll(false);
    }
  }, [services]);

  // Automatically trigger real network check when user opens the Network tab
  useEffect(() => {
    if (activeTab === 'network') {
      runNetworkProbe();
    }
  }, [activeTab, runNetworkProbe]);

  const openFolder = async (path: string) => {
    try {
      await invoke('files:open-dir', { path });
    } catch {
      // In web fallback mode
    }
  };

  // Encrypted Vault Disaster Recovery state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ success: boolean; message: string; filePath?: string; stats?: any } | null>(null);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; stats?: any } | null>(null);

  const handleExportVault = async () => {
    if (!exportPassphrase.trim()) {
      setExportResult({ success: false, message: 'Vui lòng nhập mật khẩu bảo vệ bản sao lưu.' });
      return;
    }
    setIsExporting(true);
    setExportResult(null);
    try {
      const res = await invoke<any>('vault:export', {
        passphrase: exportPassphrase,
        saveToFile: true,
      });
      if (res && res.success) {
        setExportResult({
          success: true,
          message: res.filePath
            ? `Xuất bản sao lưu thành công! Đã lưu tại: ${res.filePath}`
            : 'Xuất bản sao lưu thành công (đã lưu bản sao lưu snapshot cục bộ).',
          filePath: res.filePath || res.snapshotPath,
          stats: res.stats,
        });
        setExportPassphrase('');
      } else {
        setExportResult({
          success: false,
          message: res?.error || 'Không thể tạo bản sao lưu.',
        });
      }
    } catch (err: any) {
      setExportResult({
        success: false,
        message: err.message || 'Lỗi khi xuất bản sao lưu.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportVault = async () => {
    if (!importPassphrase.trim()) {
      setImportResult({ success: false, message: 'Vui lòng nhập mật khẩu giải mã bản sao lưu.' });
      return;
    }
    setIsImporting(true);
    setImportResult(null);
    try {
      const res = await invoke<any>('vault:import', {
        passphrase: importPassphrase,
        selectFile: true,
      });
      if (res && res.success) {
        setImportResult({
          success: true,
          message: `Khôi phục dữ liệu thành công! Đã khôi phục ${res.stats?.restoredSettings ?? 0} cấu hình, ${res.stats?.restoredProfiles ?? 0} hồ sơ doanh nghiệp và ${res.stats?.restoredCredentials ?? 0} tài khoản.`,
          stats: res.stats,
        });
        setImportPassphrase('');
        useEnterpriseStore.getState().loadProfiles().catch(() => null);
      } else if (res && res.cancelled) {
        setImportResult(null);
      } else {
        setImportResult({
          success: false,
          message: res?.error || 'Mật khẩu sai hoặc tập tin sao lưu bị lỗi/thay đổi.',
        });
      }
    } catch (err: any) {
      setImportResult({
        success: false,
        message: err.message || 'Lỗi khi khôi phục dữ liệu (mật khẩu không đúng hoặc dữ liệu bị chỉnh sửa).',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const renderVaultSection = () => (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            An Toàn Dữ Liệu Cá Nhân &amp; Khôi Phục Thảm Họa (Disaster Recovery Vault)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Mã hóa và đóng gói toàn bộ cấu hình, hồ sơ doanh nghiệp và thông tin xác thực vào tập tin bảo mật duy nhất (.ofvault)
          </p>
        </div>
      </div>

      <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl text-xs text-slate-700 flex items-start gap-3">
        <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-emerald-950">
            Dữ liệu lưu 100% trên máy tính cá nhân, có thể lưu file .ofvault lên USB/Google Drive để khôi phục trong 1 giây nếu cài lại Windows/reset trắng máy.
          </p>
          <p className="text-slate-600 text-[11px]">
            Hệ thống sử dụng chuẩn mã hóa cấp quân sự AES-256-GCM kết hợp hàm băm Scrypt sinh khóa từ mật khẩu bảo vệ của bạn. Không ai kể cả nhà phát triển có thể mở được file sao lưu nếu không có mật khẩu.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-all space-y-3">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Download className="w-4 h-4 text-emerald-600" />
            Sao lưu dữ liệu ra file
          </div>
          <p className="text-xs text-slate-500">
            Tạo tập tin sao lưu mã hóa chứa tất cả cài đặt hệ thống, hồ sơ ERP và thông tin tài khoản được bảo vệ bằng mật khẩu riêng.
          </p>
          <button
            onClick={() => { setIsExportModalOpen(true); setExportResult(null); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Xuất Bản Sao Lưu Mã Hóa (.ofvault)
          </button>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300 transition-all space-y-3">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Upload className="w-4 h-4 text-blue-600" />
            Phục hồi dữ liệu từ file
          </div>
          <p className="text-xs text-slate-500">
            Khôi phục tức thì toàn bộ cấu hình hoạt động từ tập tin <code className="text-blue-700 font-bold">.ofvault</code> đã xuất trước đó.
          </p>
          <button
            onClick={() => { setIsImportModalOpen(true); setImportResult(null); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Khôi Phục Dữ Liệu Từ Bản Sao Lưu
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1">
            OmniFlow Studio Settings
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Cài đặt hệ thống</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Cấu hình hồ sơ đa doanh nghiệp, thư mục lưu trữ hệ thống và kiểm tra an ninh hạ tầng mạng
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        {[
          { id: 'storage', label: 'Thư mục & Lưu trữ', icon: HardDrive },
          { id: 'enterprise', label: 'Hồ sơ Đa Doanh nghiệp', icon: Building2 },
          { id: 'network', label: 'Hạ tầng mạng & Kết nối', icon: Shield },
          { id: 'vault', label: 'An Toàn Dữ Liệu & Khôi Phục', icon: ShieldCheck },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`flex items-center gap-2 pb-3.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Storage Tab */}
      {activeTab === 'storage' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <h3 className="text-base font-bold text-slate-900">Cấu trúc thư mục lưu trữ hệ thống</h3>
            <p className="text-xs text-slate-500">
              Thư mục xuất đang dùng: <code className="bg-slate-100 px-1 py-0.5 rounded text-blue-700 font-bold">{reportRoot}</code>.
              Nhấn vào bất kỳ thư mục nào để mở trực tiếp trong File Explorer.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {[
                { name: 'Inventory', path: `${reportRoot}\\Inventory`, desc: 'File Excel Tồn kho (Inventory Onhand)' },
                { name: 'Sales', path: `${reportRoot}\\Sales`, desc: 'File Excel Doanh số (Sales Detail)' },
                { name: 'SAP', path: `${reportRoot}\\SAP`, desc: 'Dữ liệu xuất & báo cáo SAP Business One' },
                { name: 'PO', path: `${reportRoot}\\PO`, desc: 'Đơn đặt hàng Purchase Order tự động' },
                { name: 'Return', path: `${reportRoot}\\Return`, desc: 'Biên bản & chứng từ hàng trả về' },
                { name: 'Archive', path: `${reportRoot}\\Archive`, desc: 'Lưu trữ sao lưu lịch sử theo phiên bản' },
                { name: 'Error', path: `${reportRoot}\\Error`, desc: 'Thư mục cách ly file lỗi khi tải' },
                { name: 'Logs', path: `${reportRoot}\\Logs`, desc: 'Nhật ký audit và tiến trình thực thi' },
                { name: 'Temp', path: `${reportRoot}\\Temp`, desc: 'Vùng đệm trung gian khi tải file' },
              ].map(({ name, path, desc }) => (
                <div
                  key={name}
                  onClick={() => openFolder(path)}
                  className="p-3.5 border border-slate-200 rounded-lg hover:border-blue-500 hover:bg-blue-50/30 cursor-pointer transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900 group-hover:text-blue-700">{name}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600" />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{desc}</p>
                  <span className="text-[10px] text-slate-400 font-mono block mt-2">{path}</span>
                </div>
              ))}
            </div>
          </div>

          {renderVaultSection()}
        </div>
      )}

      {/* Vault Tab */}
      {activeTab === 'vault' && (
        <div className="space-y-6">
          {renderVaultSection()}
        </div>
      )}

      {/* Enterprise Tab */}
      {activeTab === 'enterprise' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Quản lý Cấu hình Đa Doanh nghiệp (Enterprise Profiles)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tùy chỉnh hệ thống ERP, máy chủ cơ sở dữ liệu, schema, danh mục kho và mẫu tên file cho từng doanh nghiệp.
                </p>
              </div>
              <button
                onClick={() => setIsProfilesModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Mở rộng &amp; Thêm mới
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {profiles.map((p) => {
                const isActive = p.id === activeProfileId;
                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isActive
                        ? 'border-blue-500 bg-blue-50/20 shadow-xs ring-1 ring-blue-500'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            {p.code}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                            {p.erpType}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-900 text-sm mt-2">{p.name}</h4>
                        <div className="text-xs text-slate-500 font-mono mt-1">{p.erpUrl}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Schema: <span className="text-slate-700 font-mono">{p.companySchema}</span></div>
                      </div>
                      {isActive ? (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-200">
                          Đang dùng
                        </span>
                      ) : (
                        <button
                          onClick={() => setActiveProfile(p.id)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                        >
                          Chọn kích hoạt
                        </button>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-mono text-[11px] truncate max-w-[280px]">
                        Template: <code className="text-emerald-700">{p.namingTemplate}</code>
                      </span>
                      <button
                        onClick={() => setIsProfilesModalOpen(true)}
                        className="text-blue-600 hover:text-blue-700 font-semibold text-xs"
                      >
                        Sửa chi tiết →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Network Tab */}
      {activeTab === 'network' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">Hạ tầng mạng nội bộ doanh nghiệp</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Thăm dò thời gian thực (Live TCP/HTTP Socket Probe) đến các cổng ứng dụng nghiệp vụ nội bộ
                </p>
              </div>

              <div className="flex items-center gap-3">
                {lastCheckedAt && (
                  <span className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Cập nhật lúc: <strong className="text-slate-700">{lastCheckedAt}</strong>
                  </span>
                )}
                <button
                  onClick={runNetworkProbe}
                  disabled={isProbingAll}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg shadow-2xs transition-all cursor-pointer ${
                    isProbingAll
                      ? 'bg-blue-50 text-blue-600 border border-blue-200 cursor-wait'
                      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:text-blue-700'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbingAll ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
                  {isProbingAll ? 'Đang kiểm tra kết nối...' : 'Kiểm tra lại toàn bộ'}
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {services.map((sys) => {
                const isChecking = sys.isChecking || isProbingAll;
                const isOnline = sys.reachable === true;
                const isOffline = sys.reachable === false;
                const isPending = sys.reachable === undefined && !isChecking;

                return (
                  <div
                    key={sys.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-all gap-3 ${
                      isChecking
                        ? 'bg-slate-50/70 border-slate-200 animate-pulse'
                        : isOnline
                        ? 'bg-emerald-50/30 border-emerald-200 shadow-2xs'
                        : isOffline
                        ? 'bg-rose-50/30 border-rose-200 shadow-2xs'
                        : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{sys.name}</span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          Port {sys.port}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono break-all">{sys.url}</div>

                      {/* Error or Latency Details */}
                      {isOffline && sys.error && (
                        <div className="text-[11px] text-rose-600 font-medium flex items-center gap-1.5 pt-0.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Nguyên nhân: {sys.error}</span>
                        </div>
                      )}
                      {isOnline && (
                        <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1.5 pt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Độ trễ phản hồi: <strong className="font-mono">{sys.latencyMs ?? 0}ms</strong> {sys.statusCode ? `(HTTP ${sys.statusCode})` : ''}</span>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center">
                      {isChecking ? (
                        <span className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-200 flex items-center gap-2">
                          <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
                          Đang kiểm tra kết nối...
                        </span>
                      ) : isOnline ? (
                        <span className="px-3 py-1.5 bg-emerald-100/80 text-emerald-800 text-xs font-bold rounded-full border border-emerald-300 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          Đã kết nối sẵn sàng ({sys.latencyMs}ms)
                        </span>
                      ) : isOffline ? (
                        <span className="px-3 py-1.5 bg-rose-100 text-rose-800 text-xs font-bold rounded-full border border-rose-300 flex items-center gap-1.5">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          Mất kết nối / Không phản hồi
                        </span>
                      ) : (
                        <span className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-semibold rounded-full border border-slate-200">
                          Chưa kiểm tra
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Network diagnostic note */}
            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2">
              <Shield className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <strong>Lưu ý kết nối:</strong> Nếu trạng thái hiển thị <span className="text-rose-700 font-bold">Mất kết nối / Không phản hồi</span>, vui lòng kiểm tra xem máy tính này đã bật phần mềm kết nối <strong>VPN nội bộ doanh nghiệp</strong> hoặc cáp mạng LAN nội bộ chưa. Hệ thống tự động kiểm tra thực tế tới đúng socket IP &amp; Port định tuyến.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Enterprise Profile Manager Modal */}
      <EnterpriseProfilesModal
        isOpen={isProfilesModalOpen}
        onClose={() => setIsProfilesModalOpen(false)}
      />

      {/* Export Vault Modal */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-sm">Xuất Bản Sao Lưu Mã Hóa (.ofvault)</h3>
              </div>
              <button
                onClick={() => { setIsExportModalOpen(false); setExportResult(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-600">
                Nhập mật khẩu an toàn để khóa bản sao lưu. Bạn sẽ cần mật khẩu này để khôi phục dữ liệu sau này.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                  Mật khẩu bảo vệ bản sao lưu:
                </label>
                <input
                  type="password"
                  placeholder="Nhập mật khẩu bảo vệ..."
                  value={exportPassphrase}
                  onChange={(e) => setExportPassphrase(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleExportVault(); }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  autoFocus
                />
              </div>

              {exportResult && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                    exportResult.success
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {exportResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="break-all">{exportResult.message}</div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setIsExportModalOpen(false); setExportResult(null); }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  {exportResult?.success ? 'Đóng' : 'Hủy'}
                </button>
                {!exportResult?.success && (
                  <button
                    type="button"
                    onClick={handleExportVault}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {isExporting ? 'Đang tạo bản sao lưu...' : 'Xác nhận xuất (.ofvault)'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Vault Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Khôi Phục Dữ Liệu Từ Bản Sao Lưu</h3>
              </div>
              <button
                onClick={() => { setIsImportModalOpen(false); setImportResult(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-slate-600">
                Nhập mật khẩu đã dùng khi xuất file sao lưu để giải mã và phục hồi hệ thống.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                  Mật khẩu giải mã bản sao lưu:
                </label>
                <input
                  type="password"
                  placeholder="Nhập mật khẩu giải mã..."
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleImportVault(); }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  autoFocus
                />
              </div>

              {importResult && (
                <div
                  className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                    importResult.success
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {importResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="break-all">{importResult.message}</div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setIsImportModalOpen(false); setImportResult(null); }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  {importResult?.success ? 'Đóng' : 'Hủy'}
                </button>
                {!importResult?.success && (
                  <button
                    type="button"
                    onClick={handleImportVault}
                    disabled={isImporting}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isImporting ? 'Đang giải mã...' : 'Chọn file .ofvault & Khôi phục'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
