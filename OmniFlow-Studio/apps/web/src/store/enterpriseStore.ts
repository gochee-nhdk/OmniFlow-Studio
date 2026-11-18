import { create } from 'zustand';
import {
  EnterpriseProfile,
  ERPType,
} from '@fm/shared-types';
import { invoke } from '../lib/ipc';

const STORAGE_KEY = 'omniflow_enterprise_profiles';
const ACTIVE_ID_KEY = 'omniflow_active_enterprise_id';

interface EnterpriseState {
  profiles: EnterpriseProfile[];
  activeProfileId: string;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadProfiles: () => Promise<void>;
  setActiveProfile: (id: string) => Promise<void>;
  saveProfile: (profile: Partial<EnterpriseProfile> & {
    name: string;
    code: string;
    description?: string;
    erpType?: ERPType;
    erpUrl?: string;
    posUrl?: string;
    companyName?: string;
    companySchema?: string;
  }) => Promise<EnterpriseProfile>;
  deleteProfile: (id: string) => Promise<void>;
  getActiveProfile: () => EnterpriseProfile | undefined;
}

export const useEnterpriseStore = create<EnterpriseState>((set, get) => ({
  profiles: [],
  activeProfileId: '',
  isLoading: false,
  error: null,

  loadProfiles: async () => {
    set({ isLoading: true, error: null });

    // 1. Try IPC if in Electron desktop environment
    try {
      const result = await invoke<{ profiles: EnterpriseProfile[]; activeId?: string }>('enterprise:list');
      if (result && Array.isArray(result.profiles)) {
        const active = result.profiles.length
          ? result.activeId || result.profiles.find((p) => p.isActive)?.id || result.profiles[0].id
          : '';
        set({ profiles: result.profiles, activeProfileId: active, isLoading: false });
        // Sync local storage
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(result.profiles));
          localStorage.setItem(ACTIVE_ID_KEY, active);
        } catch {
          // Ignore local storage errors
        }
        return;
      }
    } catch {
      // IPC not available or running in pure web mode - fall back to localStorage
    }

    // 2. Local storage fallback
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const storedActiveId = localStorage.getItem(ACTIVE_ID_KEY);

      if (stored) {
        const parsed = JSON.parse(stored) as EnterpriseProfile[];
        if (Array.isArray(parsed)) {
          const active = parsed.length
            ? storedActiveId && parsed.some((p) => p.id === storedActiveId)
              ? storedActiveId
              : parsed.find((p) => p.isActive)?.id || parsed[0].id
            : '';
          set({ profiles: parsed, activeProfileId: active, isLoading: false });
          return;
        }
      }
    } catch {
      // Local storage parse error - fallback to defaults
    }

    // 3. A new install starts blank. Profiles are entered by the local user.
    const defaultProfiles: EnterpriseProfile[] = [];
    const defaultActiveId = '';
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultProfiles));
      localStorage.setItem(ACTIVE_ID_KEY, defaultActiveId);
    } catch {
      // Ignore
    }
    set({ profiles: defaultProfiles, activeProfileId: defaultActiveId, isLoading: false });
  },

  setActiveProfile: async (id: string) => {
    const { profiles } = get();
    const target = profiles.find((p) => p.id === id);
    if (!target) return;

    const updated = profiles.map((p) => ({
      ...p,
      isActive: p.id === id,
    }));

    set({ profiles: updated, activeProfileId: id });

    // Sync localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(ACTIVE_ID_KEY, id);
    } catch {
      // Ignore
    }

    // Try IPC sync
    try {
      await invoke('enterprise:setActive', { id });
    } catch {
      // Graceful fallback
    }
  },

  saveProfile: async (input) => {
    const { profiles, activeProfileId } = get();
    const nowIso = new Date().toISOString();

    let savedProfile: EnterpriseProfile;

    if (input.id) {
      // Update existing
      savedProfile = {
        ...profiles.find((p) => p.id === input.id)!,
        ...input,
        updatedAt: nowIso,
      } as EnterpriseProfile;

      const updated = profiles.map((p) => (p.id === input.id ? savedProfile : p));
      set({ profiles: updated });

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    } else {
      // Create new
      const newId = `profile-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      savedProfile = {
        id: newId,
        name: input.name,
        code: input.code,
        description: input.description || '',
        erpType: input.erpType || 'SAP_B1',
        erpUrl: input.erpUrl || '',
        posUrl: input.posUrl || '',
        server: input.server || '',
        database: input.database || '',
        companyName: input.companyName || input.name,
        companySchema: input.companySchema || input.code,
        storeMappings: input.storeMappings || [],
        slocMappings: input.slocMappings || [],
        namingTemplate: input.namingTemplate || '{{orgCode}}_{{reportType}}_{{fromDate}}_{{toDate}}.xlsx',
        exportPath: input.exportPath || '',
        isActive: profiles.length === 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const updated = [...profiles, savedProfile];
      const newActiveId = profiles.length === 0 ? savedProfile.id : activeProfileId;
      set({ profiles: updated, activeProfileId: newActiveId });

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        localStorage.setItem(ACTIVE_ID_KEY, newActiveId);
      } catch {}
    }

    // Try IPC sync
    try {
      await invoke('enterprise:save', savedProfile);
    } catch {
      // Graceful fallback
    }

    return savedProfile;
  },

  deleteProfile: async (id: string) => {
    const { profiles, activeProfileId } = get();
    const updated = profiles.filter((p) => p.id !== id);

    let nextActiveId = activeProfileId;
    if (activeProfileId === id) {
      nextActiveId = updated.length > 0 ? updated[0].id : '';
      if (updated.length > 0) {
        updated[0].isActive = true;
      }
    }

    set({ profiles: updated, activeProfileId: nextActiveId });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(ACTIVE_ID_KEY, nextActiveId);
    } catch {}

    try {
      await invoke('enterprise:delete', { id });
    } catch {
      // Graceful fallback
    }
  },

  getActiveProfile: () => {
    const { profiles, activeProfileId } = get();
    const active = profiles.find((p) => p.id === activeProfileId);
    return active || profiles[0];
  },
}));
