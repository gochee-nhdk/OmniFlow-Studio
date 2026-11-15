import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ShoppingCart, FolderOpen, Play, Calendar, Filter, CheckCircle2,
  Clock, AlertTriangle, FileSpreadsheet, HardDrive, RefreshCw, Check, KeyRound, Shield, Building2, ChevronDown,
  Eye, EyeOff, Sparkles, Globe, ExternalLink
} from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { resolveNamingTemplate } from '../lib/namingTemplate';
import { invoke } from '../lib/ipc';
import { format, subDays, startOfMonth } from 'date-fns';

// Danh sách Sloc ID tổng hợp chuẩn (bao gồm cả mã kho cửa hàng & kho tổng trung tâm)
const DEFAULT_UNIFIED_SLOCS = [
  { id: 'DC01', name: 'Kho Trung Tâm DC01 - Distribution Hub' },
  { id: 'DC02', name: 'Kho Phân Phối DC02 - Logistics Center' },
  { id: 'ST01', name: 'Kho Cửa Hàng Flagship Store 01' },
  { id: 'ST02', name: 'Kho Cửa Hàng Branch Store 02' },
  { id: 'ST03', name: 'Kho Cửa Hàng Mall Store 03' },
  { id: 'ST04', name: 'Kho Cửa Hàng Gateway Store 04' },
  { id: 'ST05', name: 'Kho Cửa Hàng Express Store 05' },
];

export default function POSPage() {
  const { networkStatus, isCheckingNetwork, checkNetwork, activeProgress, isLoading, startWorkflow } = useAgentStore();
  const { getActiveProfile } = useEnterpriseStore();
  const activeProfile = getActiveProfile();

  // Danh mục kho & cửa hàng hợp nhất (Sloc ID: gộp cả storeMappings và slocMappings từ profile)
  const slocList = React.useMemo(() => {
    const stores = activeProfile?.storeMappings || [];
    const slocs = activeProfile?.slocMappings || [];
    const combined = [...slocs, ...stores];
    if (combined.length > 0) {
      // Remove potential duplicates by id
      const seen = new Set<string>();
      return combined.filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
    return DEFAULT_UNIFIED_SLOCS;
  }, [activeProfile?.storeMappings, activeProfile?.slocMappings]);

  // POS URL & Credentials state
  const [posUrl, setPosUrl] = useState(() => {
    try {
      const saved = localStorage.getItem('pos_base_url');
      if (saved && saved.trim()) return saved.trim();
      return '';
    } catch {
      return '';
    }
  });
  const [posUser, setPosUser] = useState(() => {
    try {
      return localStorage.getItem('pos_user') || 'STORE_ADMIN';
    } catch {
      return 'STORE_ADMIN';
    }
  });
  const [posPassword, setPosPassword] = useState('');
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [credSaved, setCredSaved] = useState(false);
  const [showPosPassword, setShowPosPassword] = useState(false);
  const [testingPosUrl, setTestingPosUrl] = useState(false);
  const [posUrlTestResult, setPosUrlTestResult] = useState<{ ok?: boolean; msg?: string } | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sales options
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [salesFromDate, setSalesFromDate] = useState(() => localStorage.getItem('pos_sales_from_date') || todayStr);
  const [salesToDate, setSalesToDate] = useState(() => localStorage.getItem('pos_sales_to_date') || todayStr);

  // Module 1: Sales Store Selection (Multi-select)
  const [selectedSalesStores, setSelectedSalesStores] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('pos_sales_stores') || 'null') || slocList.map(s => s.id); } catch { return slocList.map(s => s.id); } });
  const [isSalesStoreDropdownOpen, setIsSalesStoreDropdownOpen] = useState(false);
  const salesStoreDropdownRef = useRef<HTMLDivElement>(null);

  const [salesDir, setSalesDir] = useState(() => {
    try {
      return localStorage.getItem('pos_sales_dir') || `${activeProfile?.exportPath || 'Documents\\OmniFlow_Reports'}\\Sales`;
    } catch {
      return `${activeProfile?.exportPath || 'Documents\\OmniFlow_Reports'}\\Sales`;
    }
  });
  const [salesFileName, setSalesFileName] = useState(() => {
    try {
      return localStorage.getItem('pos_sales_filename') || (activeProfile?.namingTemplate || 'Sales_{FROM}_{TO}.xlsx');
    } catch {
      return 'Sales_{FROM}_{TO}.xlsx';
    }
  });

  // Module 2: Inventory Unified Sloc Selection (Multi-select)
  const [selectedInvSlocs, setSelectedInvSlocs] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('pos_inv_slocs') || 'null') || slocList.map(s => s.id); } catch { return slocList.map(s => s.id); } });
  const [isInvSlocDropdownOpen, setIsInvSlocDropdownOpen] = useState(false);
  const invSlocDropdownRef = useRef<HTMLDivElement>(null);

  const [invItem, setInvItem] = useState(() => localStorage.getItem('pos_inv_item') || '');
  const preferencesLoadedRef = useRef(false);

  useEffect(() => {
    if (!preferencesLoadedRef.current) return;
    const preferences = { posSalesFromDate: salesFromDate, posSalesToDate: salesToDate, posSelectedSalesStores: selectedSalesStores, posSelectedInvSlocs: selectedInvSlocs, posInvItem: invItem };
    try {
      localStorage.setItem('pos_sales_from_date', salesFromDate);
      localStorage.setItem('pos_sales_to_date', salesToDate);
      localStorage.setItem('pos_sales_stores', JSON.stringify(selectedSalesStores));
      localStorage.setItem('pos_inv_slocs', JSON.stringify(selectedInvSlocs));
      localStorage.setItem('pos_inv_item', invItem);
    } catch {}
    invoke('settings:set', preferences).catch(() => null);
  }, [salesFromDate, salesToDate, selectedSalesStores, selectedInvSlocs, invItem]);
  const [invDir, setInvDir] = useState(() => {
    try {
      return localStorage.getItem('pos_inv_dir') || `${activeProfile?.exportPath || 'Documents\\OmniFlow_Reports'}\\Inventory`;
    } catch {
      return `${activeProfile?.exportPath || 'Documents\\OmniFlow_Reports'}\\Inventory`;
    }
  });
  const [invFileName, setInvFileName] = useState(() => {
    try {
      return localStorage.getItem('pos_inv_filename') || 'Inventory_{SLOC}_{TIMESTAMP}.xlsx';
    } catch {
      return 'Inventory_{SLOC}_{TIMESTAMP}.xlsx';
    }
  });

  // Keep selection synchronized with slocList if empty initially or profile changes
  const prevSlocLengthRef = useRef(slocList.length);
  useEffect(() => {
    if (prevSlocLengthRef.current !== slocList.length) {
      prevSlocLengthRef.current = slocList.length;
      setSelectedSalesStores(slocList.map(s => s.id));
      setSelectedInvSlocs(slocList.map(s => s.id));
    }
  }, [slocList]);

  // Live preview for sales and inventory templates
  const isAllSalesStoresSelected = useMemo(() => {
    return slocList.length > 0 && slocList.every(s => selectedSalesStores.includes(s.id));
  }, [slocList, selectedSalesStores]);

  const isAllInvSlocsSelected = useMemo(() => {
    return slocList.length > 0 && slocList.every(s => selectedInvSlocs.includes(s.id));
  }, [slocList, selectedInvSlocs]);

  const salesPreview = useMemo(() => {
    return resolveNamingTemplate(salesFileName, {
      code: activeProfile?.code || 'DEMO_ORG',
      companySchema: activeProfile?.companySchema || 'DEMO_ORG',
      reportType: 'SALES',
      fromDate: salesFromDate,
      toDate: salesToDate,
      storeId: isAllSalesStoresSelected ? 'ALL' : selectedSalesStores[0] || 'STORE',
    });
  }, [salesFileName, activeProfile, salesFromDate, salesToDate, isAllSalesStoresSelected, selectedSalesStores]);

  const invPreview = useMemo(() => {
    return resolveNamingTemplate(invFileName, {
      code: activeProfile?.code || 'DEMO_ORG',
      companySchema: activeProfile?.companySchema || 'DEMO_ORG',
      reportType: 'INVENTORY',
      slocId: isAllInvSlocsSelected ? 'ALL_SLOC' : selectedInvSlocs[0] || 'SLOC',
      timestamp: format(new Date(), 'yyyyMMdd_HHmmss'),
    });
  }, [invFileName, activeProfile, isAllInvSlocsSelected, selectedInvSlocs]);

  // Persist POS paths and template settings
  const handleSalesDirChange = (val: string) => {
    setSalesDir(val);
    try { localStorage.setItem('pos_sales_dir', val); } catch {}
    invoke('settings:set', { posSalesDir: val }).catch(() => null);
  };

  const handleSalesFileNameChange = (val: string) => {
    setSalesFileName(val);
    try { localStorage.setItem('pos_sales_filename', val); } catch {}
    invoke('settings:set', { posSalesFileName: val }).catch(() => null);
  };

  const handleInvDirChange = (val: string) => {
    setInvDir(val);
    try { localStorage.setItem('pos_inv_dir', val); } catch {}
    invoke('settings:set', { posInvDir: val }).catch(() => null);
  };

  const handleInvFileNameChange = (val: string) => {
    setInvFileName(val);
    try { localStorage.setItem('pos_inv_filename', val); } catch {}
    invoke('settings:set', { posInvFileName: val }).catch(() => null);
  };

  useEffect(() => {
    checkNetwork();

    // Auto-load saved credentials (Username and Password state) without exposing raw secret to localStorage
    invoke<any>('credentials:get', { accountName: 'POS_MAIN' }).then((res) => {
      if (res) {
        if (res.username) {
          setPosUser(res.username);
          try { localStorage.setItem('pos_user', res.username); } catch {}
        }
        if (res.url && res.url.trim()) {
          // Chỉ lấy res.url nếu đó không phải URL của SAP bị lưu nhầm trước đây
          const cleanUrl = res.url.trim();
          if (!cleanUrl.includes(':8100') && !cleanUrl.includes('dispatcher')) {
            setPosUrl(cleanUrl);
            try { localStorage.setItem('pos_base_url', cleanUrl); } catch {}
          }
        }
        if (res.hasPassword) {
          setHasSavedPassword(true);
        }
      }
    }).catch(() => null);

    invoke<any>('settings:get').then((res: any) => {
      const data = res?.data || res;
      if (data?.posSalesFromDate) setSalesFromDate(data.posSalesFromDate);
      if (data?.posSalesToDate) setSalesToDate(data.posSalesToDate);
      if (Array.isArray(data?.posSelectedSalesStores)) setSelectedSalesStores(data.posSelectedSalesStores);
      if (Array.isArray(data?.posSelectedInvSlocs)) setSelectedInvSlocs(data.posSelectedInvSlocs);
      if (typeof data?.posInvItem === 'string') setInvItem(data.posInvItem);
      preferencesLoadedRef.current = true;
      if (data?.posBaseUrl || data?.posUrl) {
        const urlVal = (data.posBaseUrl || data.posUrl).trim();
        if (!urlVal.includes(':8100') && !urlVal.includes('dispatcher')) {
          setPosUrl(urlVal);
          try { localStorage.setItem('pos_base_url', urlVal); } catch {}
        }
      }

      if (data?.posSalesDir) {
        setSalesDir(data.posSalesDir);
        try { localStorage.setItem('pos_sales_dir', data.posSalesDir); } catch {}
      } else if (data?.defaultSavePath) {
        setSalesDir(`${data.defaultSavePath}\\Sales`);
      }

      if (data?.posSalesFileName) {
        setSalesFileName(data.posSalesFileName);
        try { localStorage.setItem('pos_sales_filename', data.posSalesFileName); } catch {}
      }

      if (data?.posInvDir) {
        setInvDir(data.posInvDir);
        try { localStorage.setItem('pos_inv_dir', data.posInvDir); } catch {}
      } else if (data?.defaultSavePath) {
        setInvDir(`${data.defaultSavePath}\\Inventory`);
      }

      if (data?.posInvFileName) {
        setInvFileName(data.posInvFileName);
        try { localStorage.setItem('pos_inv_filename', data.posInvFileName); } catch {}
      }
    }).catch(() => null);

    const handleClickOutside = (e: MouseEvent) => {
      if (salesStoreDropdownRef.current && !salesStoreDropdownRef.current.contains(e.target as Node)) {
        setIsSalesStoreDropdownOpen(false);
      }
      if (invSlocDropdownRef.current && !invSlocDropdownRef.current.contains(e.target as Node)) {
        setIsInvSlocDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePosUrlChange = (val: string) => {
    setPosUrl(val);
    setPosUrlTestResult(null);
    try { localStorage.setItem('pos_base_url', val); } catch {}
    invoke('settings:set', { posBaseUrl: val }).catch(() => null);
  };

  const handleTestPosUrl = async () => {
    if (!posUrl) return;
    setTestingPosUrl(true);
    setPosUrlTestResult(null);
    try {
      const res = await invoke<{ reachable: boolean; message?: string }>('credentials:test', { url: posUrl });
      if (res?.reachable) {
        setPosUrlTestResult({ ok: true, msg: 'Kết nối máy chủ POS thành công!' });
      } else {
        setPosUrlTestResult({ ok: false, msg: res?.message || 'Không thể kết nối tới URL POS.' });
      }
    } catch (err: any) {
      setPosUrlTestResult({ ok: false, msg: err?.message || 'Lỗi kiểm tra kết nối' });
    } finally {
      setTestingPosUrl(false);
    }
  };

  const persistCredentials = (newUser: string, newPass: string, newUrl: string = posUrl) => {
    try {
      if (newUser) localStorage.setItem('pos_user', newUser);
    } catch {}

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (newUser && newPass) {
        invoke('credentials:save', {
          accountName: 'POS_MAIN',
          username: newUser,
          password: newPass,
          application: 'POS',
          url: newUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com/',
        }).then(() => setHasSavedPassword(true)).catch(() => null);
      }
    }, 600);
  };

  const handleUserChange = (val: string) => {
    setPosUser(val);
    persistCredentials(val, posPassword, posUrl);
  };

  const handlePasswordChange = (val: string) => {
    setPosPassword(val);
    persistCredentials(posUser, val, posUrl);
  };

  const handleSaveCredentials = async () => {
    if (!posUser || (!posPassword && !hasSavedPassword)) {
      alert('Vui lòng nhập Tên tài khoản và Mật khẩu POS.');
      return;
    }
    try {
      if (posPassword) {
        await invoke('credentials:save', {
          accountName: 'POS_MAIN',
          username: posUser,
          password: posPassword,
          application: 'POS',
          url: posUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com/',
        });
        setHasSavedPassword(true);
      }
      await invoke('settings:set', { posBaseUrl: posUrl });
      try { localStorage.setItem('pos_base_url', posUrl); } catch {}
      setCredSaved(true);
      setTimeout(() => setCredSaved(false), 3000);
    } catch (e: any) {
      alert('Lỗi lưu tài khoản: ' + e.message);
    }
  };

  const handlePickSalesDir = async () => {
    try {
      const selected = await invoke<string | null>('dialog:open-directory', salesDir);
      if (selected) setSalesDir(selected);
    } catch {}
  };

  const handlePickInvDir = async () => {
    try {
      const selected = await invoke<string | null>('dialog:open-directory', invDir);
      if (selected) setInvDir(selected);
    } catch {}
  };

  const handlePresetDate = (preset: 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'THIS_MONTH') => {
    const now = new Date();
    if (preset === 'TODAY') {
      const d = format(now, 'yyyy-MM-dd');
      setSalesFromDate(d);
      setSalesToDate(d);
    } else if (preset === 'YESTERDAY') {
      const y = format(subDays(now, 1), 'yyyy-MM-dd');
      setSalesFromDate(y);
      setSalesToDate(y);
    } else if (preset === 'LAST_7') {
      setSalesFromDate(format(subDays(now, 6), 'yyyy-MM-dd'));
      setSalesToDate(format(now, 'yyyy-MM-dd'));
    } else if (preset === 'THIS_MONTH') {
      setSalesFromDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setSalesToDate(format(now, 'yyyy-MM-dd'));
    }
  };

  // Logic Toggle chọn tất cả & chọn từng mục chính xác
  const toggleItem = (currentList: string[], setList: (v: string[]) => void, id: string, allItems: Array<{ id: string }>) => {
    const allIds = allItems.map(item => item.id);
    const isAllCurrentlySelected = allIds.length > 0 && allIds.every(itemId => currentList.includes(itemId));

    if (id === 'ALL') {
      if (isAllCurrentlySelected) {
        // Đang chọn hết -> bỏ chọn tất cả
        setList([]);
      } else {
        // Chưa chọn hết -> chọn tất cả (tick toàn bộ)
        setList([...allIds]);
      }
      return;
    }

    if (currentList.includes(id)) {
      // Bỏ tick item con
      setList(currentList.filter(item => item !== id));
    } else {
      // Tick thêm item con
      setList([...currentList, id]);
    }
  };

  const getSummaryText = (selected: string[], allItems: Array<{ id: string }>) => {
    const allIds = allItems.map(item => item.id);
    const isAllSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

    if (isAllSelected) {
      return 'Tất cả (All Slocs)';
    }
    if (selected.length === 0) {
      return 'Chưa chọn Sloc';
    }
    if (selected.length === 1) {
      return selected[0];
    }
    return `${selected.length} mã đã chọn (${selected.join(', ')})`;
  };

  const handleRunSales = async () => {
    if (posUser && posPassword) {
      invoke('credentials:save', {
        accountName: 'POS_MAIN',
        username: posUser,
        password: posPassword,
        application: 'POS',
        url: posUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com/',
      }).catch(() => null);
    }

    const storeFilterArg = isAllSalesStoresSelected ? 'All' : selectedSalesStores.join(',');

    await startWorkflow('DOWNLOAD_SALES', {
      posBaseUrl: posUrl,
      posUrl: posUrl,
      fromDate: salesFromDate,
      toDate: salesToDate,
      storeFilter: storeFilterArg,
      salesOutputDir: salesDir,
      salesFileNameTemplate: salesFileName,
      orgCode: activeProfile?.code || activeProfile?.companySchema || 'ORG',
      posUser,
      posPassword: posPassword || undefined,
    });
  };

  const handleRunInventory = async () => {
    if (posUser && posPassword) {
      invoke('credentials:save', {
        accountName: 'POS_MAIN',
        username: posUser,
        password: posPassword,
        application: 'POS',
        url: posUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com/',
      }).then(() => setHasSavedPassword(true)).catch(() => null);
    }

    const slocFilterArg = isAllInvSlocsSelected ? '' : selectedInvSlocs.join(',');

    await startWorkflow('DOWNLOAD_INVENTORY', {
      posBaseUrl: posUrl,
      posUrl: posUrl,
      inventoryStoreFilter: 'All',
      inventorySlocFilter: slocFilterArg,
      inventoryItemFilter: invItem,
      inventoryOutputDir: invDir,
      inventoryFileNameTemplate: invFileName,
      orgCode: activeProfile?.code || activeProfile?.companySchema || 'ORG',
      posUser,
      posPassword: posPassword || undefined,
    });
  };

  const handleRunBoth = async () => {
    if (posUser && posPassword) {
      invoke('credentials:save', {
        accountName: 'POS_MAIN',
        username: posUser,
        password: posPassword,
        application: 'POS',
        url: posUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com/',
      }).then(() => setHasSavedPassword(true)).catch(() => null);
    }

    const salesStoreFilter = isAllSalesStoresSelected ? 'All' : selectedSalesStores.join(',');
    const invSlocFilter = isAllInvSlocsSelected ? '' : selectedInvSlocs.join(',');

    await startWorkflow('POS_AUTOMATION', {
      posBaseUrl: posUrl,
      posUrl: posUrl,
      includeSales: true,
      includeInventory: true,
      fromDate: salesFromDate,
      toDate: salesToDate,
      storeFilter: salesStoreFilter,
      salesOutputDir: salesDir,
      salesFileNameTemplate: salesFileName,
      orgCode: activeProfile?.code || activeProfile?.companySchema || 'ORG',
      inventoryStoreFilter: 'All',
      inventorySlocFilter: invSlocFilter,
      inventoryItemFilter: invItem,
      inventoryOutputDir: invDir,
      inventoryFileNameTemplate: invFileName,
      posUser,
      posPassword: posPassword || undefined,
    });
  };

  const openFolder = (path: string) => {
    invoke('files:open-dir', { path }).catch(() => null);
  };

  const isPosOnline = networkStatus?.pos ?? true;

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
            <ShoppingCart className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">POS RPFO Automation System</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Quản lý tải dữ liệu Doanh số & Tồn kho tự động từ POS RPFO ({posUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com/'})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
            isCheckingNetwork
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : isPosOnline
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              isCheckingNetwork
                ? 'bg-blue-500 animate-pulse'
                : isPosOnline
                ? 'bg-emerald-500'
                : 'bg-red-500'
            }`} />
            {isCheckingNetwork
              ? 'Đang kiểm tra kết nối...'
              : isPosOnline
              ? `POS Server Kết nối (${(() => {
                  try {
                    return new URL(posUrl || activeProfile?.erpUrl || 'http://pos.enterprise.example.com').host;
                  } catch {
                    return posUrl;
                  }
                })()})`
              : 'POS Mất kết nối'}
          </div>
          <button
            onClick={() => checkNetwork({ showFeedback: true })}
            disabled={isCheckingNetwork}
            className={`p-1.5 rounded border border-slate-200 transition-colors ${
              isCheckingNetwork
                ? 'text-blue-600 bg-blue-50 cursor-wait'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer'
            }`}
            title="Kiểm tra lại kết nối POS"
          >
            <RefreshCw className={`w-4 h-4 ${isCheckingNetwork ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main POS Config Panel */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Thiết lập Kết nối &amp; Đăng nhập POS RPFO (Tự động lưu vĩnh viễn)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cấu hình đường dẫn truy cập và tài khoản POS trực tiếp tại đây — Mật khẩu được mã hóa an toàn, tự động lưu vĩnh viễn
            </p>
          </div>
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
            RPFO POS Portal
          </span>
        </div>

        {/* Initial Entry URL / Portal Setup */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-blue-600" />
              Đường dẫn Truy cập POS (Portal URL / Base URL)
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              {posUrl ? 'Đã cấu hình' : 'Chưa thiết lập'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={posUrl}
              onChange={(e) => handlePosUrlChange(e.target.value)}
              placeholder="VD: http://172.16.1.200/ hoặc http://pos.yourdomain.local/"
              className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono text-slate-800"
            />
            <button
              type="button"
              onClick={handleTestPosUrl}
              disabled={testingPosUrl || !posUrl}
              className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title="Kiểm tra kết nối trực tiếp đến URL này"
            >
              {testingPosUrl ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              )}
              {testingPosUrl ? 'Đang kiểm tra...' : 'Kiểm tra URL'}
            </button>
          </div>
          {posUrlTestResult && (
            <div className={`text-xs px-2.5 py-1 rounded flex items-center gap-1.5 mt-1 ${
              posUrlTestResult.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {posUrlTestResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
              <span>{posUrlTestResult.msg}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              User ID (#txtName)
            </label>
            <input
              type="text"
              value={posUser}
              onChange={(e) => handleUserChange(e.target.value)}
              placeholder="VD: STORE_ADMIN"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Password (#txtPassword)
            </label>
            <div className="relative">
              <input
                type={showPosPassword ? 'text' : 'password'}
                value={posPassword}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder={hasSavedPassword ? '•••••••• (Đã lưu an toàn)' : '••••••••'}
                className="w-full pl-3 pr-9 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPosPassword(!showPosPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                title={showPosPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPosPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
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
            {credSaved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <KeyRound className="w-3.5 h-3.5" />}
            {credSaved ? 'Đã lưu cấu hình vĩnh viễn' : 'Lưu cấu hình POS'}
          </button>
        </div>
      </div>

      {/* Grid: 2 Tools side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Module 1: Tải Data Doanh Số */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">1. Tải Data Doanh Số POS</h2>
                <p className="text-xs text-slate-500 mt-0.5">Xuất chi tiết giao dịch bán hàng theo khoảng thời gian</p>
              </div>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                sales-transaction-detail
              </span>
            </div>

            {/* Quick Presets */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Khoảng thời gian nhanh</label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: 'Hôm nay', id: 'TODAY' },
                  { label: 'Hôm qua', id: 'YESTERDAY' },
                  { label: '7 ngày qua', id: 'LAST_7' },
                  { label: 'Tháng này', id: 'THIS_MONTH' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetDate(p.id as any)}
                    className="py-1.5 px-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 text-center transition-colors cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date range inputs */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Từ ngày (From)</label>
                <input
                  type="date"
                  value={salesFromDate}
                  onChange={(e) => setSalesFromDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Đến ngày (To)</label>
                <input
                  type="date"
                  value={salesToDate}
                  onChange={(e) => setSalesToDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                />
              </div>
            </div>

            {/* Module 1: Sloc ID / Cửa hàng Dropdown (Đồng nhất gộp chung) */}
            <div className="relative" ref={salesStoreDropdownRef}>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Sloc ID / Cửa hàng
              </label>

              <button
                type="button"
                onClick={() => setIsSalesStoreDropdownOpen(!isSalesStoreDropdownOpen)}
                className="w-full px-3 py-1.5 text-sm font-mono text-left bg-white border border-slate-300 rounded flex items-center justify-between hover:border-slate-400 focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <span className="truncate text-slate-800">
                  {getSummaryText(selectedSalesStores, slocList)}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
              </button>

              {isSalesStoreDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-300 rounded-md shadow-lg max-h-56 overflow-y-auto p-1.5 space-y-1">
                  <div
                    onClick={() => toggleItem(selectedSalesStores, setSelectedSalesStores, 'ALL', slocList)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs cursor-pointer ${
                      isAllSalesStoresSelected ? 'bg-blue-50 font-bold text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isAllSalesStoresSelected}
                      onChange={() => {}}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Tất cả Sloc ID (kho tổng & cửa hàng)</span>
                  </div>

                  {slocList.map((st) => {
                    const isChecked = selectedSalesStores.includes(st.id);
                    return (
                      <div
                        key={st.id}
                        onClick={() => toggleItem(selectedSalesStores, setSelectedSalesStores, st.id, slocList)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer font-mono ${
                          isChecked ? 'bg-slate-100 font-semibold text-slate-900' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{st.id}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-sans truncate max-w-[150px]">{st.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Output Directory & File template */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Thư mục lưu file Doanh số (Tự động lưu)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={salesDir}
                    onChange={(e) => handleSalesDirChange(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded bg-slate-50 font-mono text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handlePickSalesDir}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded cursor-pointer whitespace-nowrap"
                  >
                    Chọn...
                  </button>
                  <button
                    type="button"
                    onClick={() => openFolder(salesDir)}
                    className="p-2 text-slate-500 hover:text-slate-700 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                    title="Mở thư mục"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Mẫu tên file Doanh số (Tự động lưu)</label>
                <input
                  type="text"
                  value={salesFileName}
                  onChange={(e) => handleSalesFileNameChange(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  placeholder="Sales_{FROM}_{TO}.xlsx"
                />
                <div className="mt-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded flex items-center justify-between text-xs">
                  <span className="text-slate-500">Xem trước:</span>
                  <span className="font-mono font-bold text-emerald-700 truncate max-w-[260px]">{salesPreview}</span>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleRunSales}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs py-2.5 px-4 rounded shadow transition-colors cursor-pointer mt-4"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Tải Data Doanh Số (Excel)
          </button>
        </div>

        {/* Module 2: Tải Data Tồn Kho (Gộp chung thành 1 phần Sloc ID duy nhất) */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900">2. Tải Data Tồn Kho POS</h2>
                <p className="text-xs text-slate-500 mt-0.5">Xuất dữ liệu tồn kho tức thời (On-hand) theo kho / cửa hàng</p>
              </div>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                inventory-onhand
              </span>
            </div>

            {/* Sloc ID duy nhất gộp cả cửa hàng và kho tổng */}
            <div className="relative" ref={invSlocDropdownRef}>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Mã kho & Cửa hàng (Sloc ID)
              </label>

              <button
                type="button"
                onClick={() => setIsInvSlocDropdownOpen(!isInvSlocDropdownOpen)}
                className="w-full px-3 py-1.5 text-sm font-mono text-left bg-white border border-slate-300 rounded flex items-center justify-between hover:border-slate-400 focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <span className="truncate text-slate-800">
                  {getSummaryText(selectedInvSlocs, slocList)}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
              </button>

              {isInvSlocDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-300 rounded-md shadow-lg max-h-56 overflow-y-auto p-1.5 space-y-1">
                  <div
                    onClick={() => toggleItem(selectedInvSlocs, setSelectedInvSlocs, 'ALL', slocList)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs cursor-pointer ${
                      isAllInvSlocsSelected ? 'bg-blue-50 font-bold text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isAllInvSlocsSelected}
                      onChange={() => {}}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Tất cả Sloc ID (kho tổng & cửa hàng)</span>
                  </div>

                  {slocList.map((sl) => {
                    const isChecked = selectedInvSlocs.includes(sl.id);
                    return (
                      <div
                        key={sl.id}
                        onClick={() => toggleItem(selectedInvSlocs, setSelectedInvSlocs, sl.id, slocList)}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer font-mono ${
                          isChecked ? 'bg-slate-100 font-semibold text-slate-900' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{sl.id}</span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-sans truncate max-w-[150px]">{sl.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Item Filter */}
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Mã hàng hoặc Tên hàng <span className="text-slate-400 font-normal">(tùy chọn)</span>
              </label>
              <input
                type="text"
                value={invItem}
                onChange={(e) => setInvItem(e.target.value)}
                placeholder="VD: B0000001 (để trống nếu lấy tất cả)"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
            </div>

            {/* Output Directory & File template */}
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Thư mục lưu file Tồn kho (Tự động lưu)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={invDir}
                    onChange={(e) => handleInvDirChange(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded bg-slate-50 font-mono text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handlePickInvDir}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded cursor-pointer whitespace-nowrap"
                  >
                    Chọn...
                  </button>
                  <button
                    type="button"
                    onClick={() => openFolder(invDir)}
                    className="p-2 text-slate-500 hover:text-slate-700 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                    title="Mở thư mục"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Mẫu tên file Tồn kho (Tự động lưu)</label>
                <input
                  type="text"
                  value={invFileName}
                  onChange={(e) => handleInvFileNameChange(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  placeholder="Inventory_{SLOC}_{TIMESTAMP}.xlsx"
                />
                <div className="mt-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded flex items-center justify-between text-xs">
                  <span className="text-slate-500">Xem trước:</span>
                  <span className="font-mono font-bold text-emerald-700 truncate max-w-[260px]">{invPreview}</span>
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={handleRunInventory}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs py-2.5 px-4 rounded shadow transition-colors cursor-pointer mt-4"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Tải Data Tồn Kho (Excel)
          </button>
        </div>
      </div>

      {/* Action Box: Chạy toàn bộ quy trình */}
      <div className="bg-slate-900 rounded-lg p-5 text-white flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-white">Quy trình tự động POS (Doanh số + Tồn kho)</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            Tự động tải theo danh sách Sloc ID đã chọn, bắt trực tiếp Blob và lưu file Excel an toàn
          </p>
        </div>

        <button
          onClick={handleRunBoth}
          disabled={isLoading}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-bold text-sm px-5 py-2.5 rounded shadow transition-colors cursor-pointer whitespace-nowrap"
        >
          <Play className="w-4 h-4 fill-current" />
          {isLoading ? 'Đang thực thi...' : 'Chạy Cả 2 Báo Cáo'}
        </button>
      </div>
    </div>
  );
}
