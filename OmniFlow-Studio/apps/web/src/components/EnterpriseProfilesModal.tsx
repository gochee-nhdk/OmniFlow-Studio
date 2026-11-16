import React, { useState } from 'react';
import {
  Building2, Plus, Check, Edit3, Trash2, X, RefreshCw, FileText,
  Server, Globe, Database, FolderCheck, CheckCircle2, ChevronRight, FolderOpen
} from 'lucide-react';
import { useEnterpriseStore } from '../store/enterpriseStore';
import { EnterpriseProfile, ERPType } from '@fm/shared-types';
import { invoke } from '../lib/ipc';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ERP_OPTIONS: Array<{ value: ERPType; label: string; badgeClass: string; icon: string }> = [
  { value: 'SAP_B1', label: 'SAP Business One', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200', icon: '🏢' },
  { value: 'ODOO', label: 'Odoo Enterprise', badgeClass: 'bg-purple-100 text-purple-800 border-purple-200', icon: '🟣' },
  { value: 'NETSUITE', label: 'Oracle NetSuite', badgeClass: 'bg-amber-100 text-amber-800 border-amber-200', icon: '🟠' },
  { value: 'CUSTOM_WEB', label: 'Custom Web POS/ERP', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: '🌐' },
];

export default function EnterpriseProfilesModal({ isOpen, onClose }: Props) {
  const { profiles, activeProfileId, setActiveProfile, saveProfile, deleteProfile } = useEnterpriseStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state - Foundation enterprise parameters only
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formErpType, setFormErpType] = useState<ERPType>('SAP_B1');
  const [formErpUrl, setFormErpUrl] = useState('');
  const [formPosUrl, setFormPosUrl] = useState('');
  const [formServer, setFormServer] = useState('');
  const [formDatabase, setFormDatabase] = useState('');
  const [formCompanyName, setFormCompanyName] = useState('');
  const [formCompanySchema, setFormCompanySchema] = useState('');
  const [formExportPath, setFormExportPath] = useState('');
  const [defaultExportPath, setDefaultExportPath] = useState('');

  // Mappings
  const [storeMappings, setStoreMappings] = useState<Array<{ id: string; name: string }>>([]);
  const [newStoreId, setNewStoreId] = useState('');
  const [newStoreName, setNewStoreName] = useState('');
  const [editingStoreIdx, setEditingStoreIdx] = useState<number | null>(null);
  const [editStoreId, setEditStoreId] = useState('');
  const [editStoreName, setEditStoreName] = useState('');

  const [slocMappings, setSlocMappings] = useState<Array<{ id: string; name: string }>>([]);
  const [newSlocId, setNewSlocId] = useState('');
  const [newSlocName, setNewSlocName] = useState('');
  const [editingSlocIdx, setEditingSlocIdx] = useState<number | null>(null);
  const [editSlocId, setEditSlocId] = useState('');
  const [editSlocName, setEditSlocName] = useState('');

  React.useEffect(() => {
    invoke<{ documents?: string }>('app:get-paths').then((paths) => {
      if (paths?.documents) setDefaultExportPath(`${paths.documents}\\OmniFlow_Reports`);
    }).catch(() => null);
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setFormName('');
    setFormCode('');
    setFormErpType('SAP_B1');
    setFormErpUrl('https://');
    setFormPosUrl('https://');
    setFormServer('');
    setFormDatabase('');
    setFormCompanyName('');
    setFormCompanySchema('');
    setFormExportPath(defaultExportPath);
    // New profiles have no POS locations until the user configures them here.
    setStoreMappings([]);
    setSlocMappings([]);
    setEditingStoreIdx(null);
    setEditingSlocIdx(null);
    setIsEditing(true);
  };

  const startEdit = (p: EnterpriseProfile) => {
    setEditingId(p.id);
    setFormName(p.name);
    setFormCode(p.code);
    setFormErpType(p.erpType);
    setFormErpUrl(p.erpUrl);
    setFormPosUrl(p.posUrl || '');
    setFormServer(p.server || '');
    setFormDatabase(p.database || '');
    setFormCompanyName(p.companyName);
    setFormCompanySchema(p.companySchema);
    setFormExportPath(p.exportPath || defaultExportPath);
    setStoreMappings(p.storeMappings ? [...p.storeMappings] : []);
    setSlocMappings(p.slocMappings ? [...p.slocMappings] : []);
    setEditingStoreIdx(null);
    setEditingSlocIdx(null);
    setIsEditing(true);
  };

  const handlePickExportPath = async () => {
    try {
      const selected = await invoke<string | null>('dialog:open-directory', formExportPath);
      if (selected) {
        setFormExportPath(selected);
      }
    } catch {}
  };

  const handleOpenExportFolder = (path: string) => {
    invoke('files:open-dir', { path }).catch(() => null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formCode || !formCompanyName || !formCompanySchema) return;

    await saveProfile({
      id: editingId || undefined,
      name: formName.trim(),
      code: formCode.trim().toUpperCase(),
      erpType: formErpType,
      erpUrl: formErpUrl.trim(),
      posUrl: formPosUrl.trim() || undefined,
      server: formServer.trim() || undefined,
      database: formDatabase.trim() || undefined,
      companyName: formCompanyName.trim(),
      companySchema: formCompanySchema.trim(),
      exportPath: formExportPath.trim(),
      storeMappings,
      slocMappings,
    });

    setIsEditing(false);
  };

  // Inline edit handlers for Store
  const handleStartEditStore = (idx: number) => {
    setEditingStoreIdx(idx);
    setEditStoreId(storeMappings[idx].id);
    setEditStoreName(storeMappings[idx].name);
  };

  const handleSaveEditStore = (idx: number) => {
    if (!editStoreId.trim()) return;
    setStoreMappings((prev) =>
      prev.map((s, i) =>
        i === idx ? { id: editStoreId.trim(), name: editStoreName.trim() || editStoreId.trim() } : s
      )
    );
    setEditingStoreIdx(null);
  };

  // Inline edit handlers for Sloc
  const handleStartEditSloc = (idx: number) => {
    setEditingSlocIdx(idx);
    setEditSlocId(slocMappings[idx].id);
    setEditSlocName(slocMappings[idx].name);
  };

  const handleSaveEditSloc = (idx: number) => {
    if (!editSlocId.trim()) return;
    setSlocMappings((prev) =>
      prev.map((sl, i) =>
        i === idx ? { id: editSlocId.trim(), name: editSlocName.trim() || editSlocId.trim() } : sl
      )
    );
    setEditingSlocIdx(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Quản lý Đa Doanh Nghiệp (Enterprise Profiles)</h2>
              <p className="text-xs text-slate-500">
                Cấu hình hồ sơ nền tảng doanh nghiệp, kết nối ERP/POS, danh mục kho hàng và cửa hàng
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isEditing ? (
            /* List View */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Danh sách hồ sơ doanh nghiệp ({profiles.length})
                </span>
                <button
                  onClick={startCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Thêm doanh nghiệp mới
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {profiles.map((p) => {
                  const isActive = p.id === activeProfileId;
                  const erpBadge = ERP_OPTIONS.find((e) => e.value === p.erpType);

                  return (
                    <div
                      key={p.id}
                      className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                        isActive
                          ? 'border-blue-500 bg-blue-50/20 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                            {p.code}
                          </span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${erpBadge?.badgeClass || 'bg-slate-100'}`}>
                            {erpBadge?.icon} {erpBadge?.label || p.erpType}
                          </span>
                          {isActive && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Đang kích hoạt
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm font-bold text-slate-900">{p.name}</h3>

                        <div className="flex items-center gap-4 text-xs text-slate-500 font-mono flex-wrap">
                          <span>Schema: <strong className="text-slate-700">{p.companySchema}</strong></span>
                          <span>URL: <span className="text-slate-700 truncate max-w-[200px] inline-block align-bottom">{p.erpUrl}</span></span>
                          {(p.storeMappings || p.slocMappings) && (
                            <span className="text-slate-400">
                              ({(p.storeMappings?.length || 0)} cửa hàng, {(p.slocMappings?.length || 0)} kho)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {!isActive ? (
                          <button
                            onClick={() => setActiveProfile(p.id)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors"
                          >
                            Kích hoạt
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Hồ sơ mặc định hệ thống</span>
                        )}

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(p)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Chỉnh sửa"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {profiles.length > 1 && (
                            <button
                              onClick={() => {
                                if (confirm(`Bạn có chắc chắn muốn xóa hồ sơ "${p.name}"?`)) {
                                  deleteProfile(p.id);
                                }
                              }}
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              title="Xóa hồ sơ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Create / Edit Form View */
            <form onSubmit={handleSave} className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingId ? 'Chỉnh sửa hồ sơ doanh nghiệp' : 'Tạo hồ sơ doanh nghiệp mới'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-xs text-slate-500 hover:text-slate-700 font-semibold cursor-pointer"
                >
                  ← Quay lại danh sách
                </button>
              </div>

              {/* Basic Enterprise Platform Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên hiển thị doanh nghiệp *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Nhập tên doanh nghiệp"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mã tổ chức (Org Code) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="Nhập mã tổ chức"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono uppercase focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Hệ thống ERP / POS
                  </label>
                  <select
                    value={formErpType}
                    onChange={(e) => setFormErpType(e.target.value as ERPType)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {ERP_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.icon} {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    URL kết nối SAP SLD (erpUrl) *
                  </label>
                  <input
                    type="url"
                    required
                    value={formErpUrl}
                    onChange={(e) => setFormErpUrl(e.target.value)}
                    placeholder="https://sap-sld.domain.com:8443"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    URL kết nối POS RPFO (posUrl)
                  </label>
                  <input
                    type="url"
                    value={formPosUrl}
                    onChange={(e) => setFormPosUrl(e.target.value)}
                    placeholder="https://pos-rpfo.domain.com"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên công ty pháp nhân trên ERP *
                  </label>
                  <input
                    type="text"
                    required
                    value={formCompanyName}
                    onChange={(e) => setFormCompanyName(e.target.value)}
                    placeholder="Tên công ty trong ERP"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Schema / Mã công ty DB (Database Schema) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formCompanySchema}
                    onChange={(e) => setFormCompanySchema(e.target.value)}
                    placeholder="Tên database schema"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Database Server (Tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={formServer}
                    onChange={(e) => setFormServer(e.target.value)}
                    placeholder="Địa chỉ server SAP, nếu có"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Database Name / Catalog (Tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={formDatabase}
                    onChange={(e) => setFormDatabase(e.target.value)}
                    placeholder="Tên database hoặc catalog"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Thư mục xuất file tự động mặc định
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formExportPath}
                      onChange={(e) => setFormExportPath(e.target.value)}
                      placeholder="Thư mục lưu báo cáo của doanh nghiệp"
                      className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded bg-slate-50 font-mono text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handlePickExportPath}
                      className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded cursor-pointer whitespace-nowrap"
                    >
                      Chọn...
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenExportFolder(formExportPath)}
                      className="p-2 text-slate-500 hover:text-slate-700 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                      title="Mở thư mục"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Store & Sloc Mappings - Layout cân đối, đều đặn, hỗ trợ sửa inline và xóa */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Store Mappings */}
                <div className="border border-slate-200 rounded-xl p-4 bg-white flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-slate-800">Danh mục Cửa hàng / Chi nhánh</h4>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const sampleStores = [
                              { id: 'DC0101', name: 'Tổng kho DC' },
                              { id: 'SFM0101', name: 'Cửa hàng SFM 01' },
                              { id: 'SFM0201', name: 'Cửa hàng SFM 02' },
                              { id: 'SFM0301', name: 'Cửa hàng SFM 03' },
                            ];
                            setStoreMappings((prev) => {
                              const existingIds = new Set(prev.map((s) => s.id));
                              const toAdd = sampleStores.filter((s) => !existingIds.has(s.id));
                              return [...prev, ...toAdd];
                            });
                          }}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer"
                        >
                          + Nạp mẫu
                        </button>
                        <span className="text-[10px] font-mono text-slate-400">{storeMappings.length} mục</span>
                      </div>
                    </div>

                    {/* Table Header: 4 cols balanced (Mã: 4, Tên: 5, Sửa: 1.5, Xóa: 1.5) */}
                    <div className="grid grid-cols-12 gap-2 px-2.5 py-1.5 bg-slate-100 rounded text-[11px] font-bold text-slate-600 mb-1">
                      <div className="col-span-4">Mã cửa hàng</div>
                      <div className="col-span-5">Tên cửa hàng</div>
                      <div className="col-span-3 text-center">Thao tác</div>
                    </div>

                    <div className="space-y-1 max-h-48 overflow-y-auto mb-3 pr-1">
                      {storeMappings.map((s, idx) => {
                        const isThisEditing = editingStoreIdx === idx;
                        return (
                          <div
                            key={idx}
                            className={`grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded text-xs border ${
                              isThisEditing ? 'bg-blue-50/50 border-blue-200' : 'bg-slate-50 hover:bg-slate-100 border-slate-100'
                            }`}
                          >
                            {isThisEditing ? (
                              <>
                                <input
                                  type="text"
                                  value={editStoreId}
                                  onChange={(e) => setEditStoreId(e.target.value)}
                                  className="col-span-4 px-1.5 py-1 text-xs border border-blue-300 rounded font-mono bg-white"
                                />
                                <input
                                  type="text"
                                  value={editStoreName}
                                  onChange={(e) => setEditStoreName(e.target.value)}
                                  className="col-span-5 px-1.5 py-1 text-xs border border-blue-300 rounded bg-white"
                                />
                                <div className="col-span-3 flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditStore(idx)}
                                    className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded"
                                    title="Lưu"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingStoreIdx(null)}
                                    className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                                    title="Hủy"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="col-span-4 font-mono text-slate-900 font-semibold truncate" title={s.id}>
                                  {s.id}
                                </div>
                                <div className="col-span-5 text-slate-700 truncate" title={s.name}>
                                  {s.name}
                                </div>
                                <div className="col-span-3 flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditStore(idx)}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-none"
                                    title="Sửa"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setStoreMappings((prev) => prev.filter((_, i) => i !== idx))}
                                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-none"
                                    title="Xóa"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-1.5 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      placeholder="Mã cửa hàng"
                      value={newStoreId}
                      onChange={(e) => setNewStoreId(e.target.value)}
                      className="col-span-4 px-2 py-1.5 text-xs border border-slate-200 rounded font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Tên cửa hàng"
                      value={newStoreName}
                      onChange={(e) => setNewStoreName(e.target.value)}
                      className="col-span-5 px-2 py-1.5 text-xs border border-slate-200 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newStoreId.trim()) {
                          const idVal = newStoreId.trim();
                          const nameVal = newStoreName.trim() || idVal;
                          setStoreMappings((prev) => [...prev, { id: idVal, name: nameVal }]);
                          setNewStoreId('');
                          setNewStoreName('');
                        }
                      }}
                      className="col-span-3 py-1.5 text-xs font-bold text-white bg-slate-800 rounded hover:bg-slate-700 cursor-pointer text-center"
                    >
                      + Thêm
                    </button>
                  </div>
                </div>

                {/* Sloc Mappings */}
                <div className="border border-slate-200 rounded-xl p-4 bg-white flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-slate-800">Danh mục Kho lưu trữ (Storage Locations)</h4>
                      <span className="text-[10px] font-mono text-slate-400">{slocMappings.length} mục</span>
                    </div>

                    {/* Table Header: 4 cols balanced (Mã: 4, Tên: 5, Thao tác: 3) */}
                    <div className="grid grid-cols-12 gap-2 px-2.5 py-1.5 bg-slate-100 rounded text-[11px] font-bold text-slate-600 mb-1">
                      <div className="col-span-4">Mã kho (Sloc ID)</div>
                      <div className="col-span-5">Tên kho</div>
                      <div className="col-span-3 text-center">Thao tác</div>
                    </div>

                    <div className="space-y-1 max-h-48 overflow-y-auto mb-3 pr-1">
                      {slocMappings.map((sl, idx) => {
                        const isThisEditing = editingSlocIdx === idx;
                        return (
                          <div
                            key={idx}
                            className={`grid grid-cols-12 gap-2 items-center px-2 py-1.5 rounded text-xs border ${
                              isThisEditing ? 'bg-blue-50/50 border-blue-200' : 'bg-slate-50 hover:bg-slate-100 border-slate-100'
                            }`}
                          >
                            {isThisEditing ? (
                              <>
                                <input
                                  type="text"
                                  value={editSlocId}
                                  onChange={(e) => setEditSlocId(e.target.value)}
                                  className="col-span-4 px-1.5 py-1 text-xs border border-blue-300 rounded font-mono bg-white"
                                />
                                <input
                                  type="text"
                                  value={editSlocName}
                                  onChange={(e) => setEditSlocName(e.target.value)}
                                  className="col-span-5 px-1.5 py-1 text-xs border border-blue-300 rounded bg-white"
                                />
                                <div className="col-span-3 flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEditSloc(idx)}
                                    className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded"
                                    title="Lưu"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingSlocIdx(null)}
                                    className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                                    title="Hủy"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="col-span-4 font-mono text-slate-900 font-semibold truncate" title={sl.id}>
                                  {sl.id}
                                </div>
                                <div className="col-span-5 text-slate-700 truncate" title={sl.name}>
                                  {sl.name}
                                </div>
                                <div className="col-span-3 flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditSloc(idx)}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-none"
                                    title="Sửa"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSlocMappings((prev) => prev.filter((_, i) => i !== idx))}
                                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-none"
                                    title="Xóa"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-1.5 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      placeholder="Mã kho"
                      value={newSlocId}
                      onChange={(e) => setNewSlocId(e.target.value)}
                      className="col-span-4 px-2 py-1.5 text-xs border border-slate-200 rounded font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Tên kho"
                      value={newSlocName}
                      onChange={(e) => setNewSlocName(e.target.value)}
                      className="col-span-5 px-2 py-1.5 text-xs border border-slate-200 rounded"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newSlocId.trim()) {
                          const idVal = newSlocId.trim();
                          const nameVal = newSlocName.trim() || idVal;
                          setSlocMappings((prev) => [...prev, { id: idVal, name: nameVal }]);
                          setNewSlocId('');
                          setNewSlocName('');
                        }
                      }}
                      className="col-span-3 py-1.5 text-xs font-bold text-white bg-slate-800 rounded hover:bg-slate-700 cursor-pointer text-center"
                    >
                      + Thêm
                    </button>
                  </div>
                </div>
              </div>

              {/* Form Action buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-xs cursor-pointer"
                >
                  Lưu thay đổi hồ sơ
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
