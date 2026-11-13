import React, { useState } from 'react';
import { Shield, HardDrive, KeyRound, Check, ExternalLink } from 'lucide-react';
import { invoke } from '../lib/ipc';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'credentials' | 'storage' | 'network'>('credentials');

  // SAP Credentials
  const [sapUser, setSapUser] = useState('');
  const [sapPass, setSapPass] = useState('');
  const [sapSaved, setSapSaved] = useState(false);

  // POS Credentials
  const [posUser, setPosUser] = useState('');
  const [posPass, setPosPass] = useState('');
  const [posSaved, setPosSaved] = useState(false);

  const [testResult, setTestResult] = useState<string | null>(null);

  const handleSaveSap = async () => {
    try {
      await invoke('credentials:save', {
        accountName: 'SAP_MAIN',
        username: sapUser,
        password: sapPass,
        application: 'SAP',
        url: 'https://172.16.1.210:8100/dispatcher/',
      });
      setSapSaved(true);
      setTimeout(() => setSapSaved(false), 3000);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleSavePos = async () => {
    try {
      await invoke('credentials:save', {
        accountName: 'POS_MAIN',
        username: posUser,
        password: posPass,
        application: 'POS',
        url: 'http://172.16.1.200/',
      });
      setPosSaved(true);
      setTimeout(() => setPosSaved(false), 3000);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleTestConnection = async (url: string) => {
    setTestResult(`Testing connection to ${url}...`);
    try {
      const res = await invoke<{ reachable: boolean; message: string }>('credentials:test', { url });
      setTestResult(res.reachable ? `✓ ${res.message}` : `✗ ${res.message}`);
    } catch {
      setTestResult('✗ Connection check failed');
    }
  };

  const openFolder = async (path: string) => {
    try {
      await invoke('files:open-dir', { path });
    } catch {
      // In web fallback mode
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings & Configuration</h1>
        <p className="text-slate-500 text-sm mt-1">Local credential vault, directory pathways, and environment policies</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6">
        {[
          { id: 'credentials', label: 'Credentials Vault', icon: KeyRound },
          { id: 'storage', label: 'Storage & Folders', icon: HardDrive },
          { id: 'network', label: 'Security & Network', icon: Shield },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`flex items-center gap-2 pb-3.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === id
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Credentials Tab */}
      {activeTab === 'credentials' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 flex items-start gap-3">
            <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <strong>Windows Credential Manager Encrypted Storage:</strong> Passwords are saved directly into the Windows OS Credential Vault using secure native APIs. Passwords are never sent to any cloud server, never logged in diagnostic files, and never saved in plaintext.
            </div>
          </div>

          {/* SAP Account */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">SAP Business One Account</h3>
                <span className="text-xs text-slate-400 font-mono">https://172.16.1.210:8100/dispatcher/</span>
              </div>
              <button
                onClick={() => handleTestConnection('https://172.16.1.210:8100/dispatcher/')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-md cursor-pointer"
              >
                Test Connection
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username / User Code</label>
                <input
                  type="text"
                  value={sapUser}
                  onChange={(e) => setSapUser(e.target.value)}
                  placeholder="e.g. manager"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={sapPass}
                  onChange={(e) => setSapPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveSap}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer transition-colors"
              >
                {sapSaved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : null}
                {sapSaved ? 'Saved to Windows Vault' : 'Save SAP Credentials'}
              </button>
            </div>
          </div>

          {/* POS Account */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">POS RPFO Account</h3>
                <span className="text-xs text-slate-400 font-mono">http://172.16.1.200/</span>
              </div>
              <button
                onClick={() => handleTestConnection('http://172.16.1.200/')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-md cursor-pointer"
              >
                Test Connection
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                <input
                  type="text"
                  value={posUser}
                  onChange={(e) => setPosUser(e.target.value)}
                  placeholder="e.g. admin"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={posPass}
                  onChange={(e) => setPosPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSavePos}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-pointer transition-colors"
              >
                {posSaved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : null}
                {posSaved ? 'Saved to Windows Vault' : 'Save POS Credentials'}
              </button>
            </div>
          </div>

          {testResult && (
            <div className="p-3 bg-slate-100 rounded-lg text-xs font-mono text-slate-700">
              {testResult}
            </div>
          )}
        </div>
      )}

      {/* Storage Tab */}
      {activeTab === 'storage' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Procurement Folder Architecture</h3>
              <p className="text-xs text-slate-500 mt-0.5">Root Directory: <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">D:\FM_AUTO_OPS</code></p>
            </div>

            <div className="space-y-2.5">
              {[
                { name: 'Inventory Reports', path: 'D:\\FM_AUTO_OPS\\Inventory', desc: 'Auto-downloaded Inventory Onhand Excel files' },
                { name: 'Sales Transactions', path: 'D:\\FM_AUTO_OPS\\Sales', desc: 'Daily/period sales transaction workbooks' },
                { name: 'SAP Documents', path: 'D:\\FM_AUTO_OPS\\SAP', desc: 'SAP Business One exported records' },
                { name: 'Purchase Orders', path: 'D:\\FM_AUTO_OPS\\PO', desc: 'Generated & drafted PO data' },
                { name: 'Return Records', path: 'D:\\FM_AUTO_OPS\\Return', desc: 'Return workflows and summaries' },
                { name: 'Archive Vault', path: 'D:\\FM_AUTO_OPS\\Archive', desc: 'Previous execution files and backup copies' },
                { name: 'Error Quarantine', path: 'D:\\FM_AUTO_OPS\\Error', desc: 'Damaged or unvalidated downloads' },
                { name: 'Execution Logs', path: 'D:\\FM_AUTO_OPS\\Logs', desc: 'Local audit and operational logs' },
              ].map(({ name, path, desc }) => (
                <div key={path} className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg border border-slate-100">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{name}</div>
                    <div className="text-xs font-mono text-slate-500">{path}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{desc}</div>
                  </div>
                  <button
                    onClick={() => openFolder(path)}
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Folder
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeTab === 'network' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-xs">
          <h3 className="text-base font-bold text-slate-900">Security Architecture & Transport Disclosures</h3>
          <ul className="text-sm text-slate-600 space-y-2 list-disc list-inside">
            <li><strong>POS HTTP Unencrypted:</strong> The internal POS system operates at <code>http://172.16.1.200</code>. Automation accesses it locally across the private intranet.</li>
            <li><strong>SAP Self-Signed SSL:</strong> The internal SAP server at <code>https://172.16.1.210:8100</code> uses an enterprise self-signed certificate, managed in isolated Chromium contexts.</li>
            <li><strong>Zero Cloud Sync of Passwords:</strong> Credentials remain strictly on this Windows device.</li>
            <li><strong>Predefined RPA Commands:</strong> No arbitrary terminal or shell scripts are executable through the dashboard.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
