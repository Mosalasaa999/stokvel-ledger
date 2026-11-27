import { create } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";
import type { SupportedLang } from "../lib/i18n";

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => new Promise<string | null>((resolve) => {
    const req = indexedDB.open("stokvel_device_vault", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get(name);
      g.onsuccess = () => resolve(g.result ?? null);
      g.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  }),
  setItem: async (name: string, value: string): Promise<void> => new Promise<void>((resolve) => {
    const req = indexedDB.open("stokvel_device_vault", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, name);
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => resolve();
  }),
  removeItem: async (name: string): Promise<void> => new Promise<void>((resolve) => {
    const req = indexedDB.open("stokvel_device_vault", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(name);
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => resolve();
  })
};

interface LedgerState {
  slug: string;
  shortCode: string;
  msisdn: string;
  memberId: string;
  token: string;
  role: "TREASURER" | "MEMBER" | "";
  lang: SupportedLang;
  rememberPhone: boolean;
  expiresAt: number;
  cachedLedger: any | null;
  setSession: (p: { slug: string; shortCode?: string; msisdn?: string; memberId?: string; token: string; role: "TREASURER" | "MEMBER"; remember?: boolean }) => void;
  setLang: (lang: SupportedLang) => void;
  setCachedLedger: (data: any) => void;
  logout: () => void;
}

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set) => ({
      slug: "",
      shortCode: "",
      msisdn: "",
      memberId: "",
      token: "",
      role: "",
      lang: "en-ZA",
      rememberPhone: true,
      expiresAt: 0,
      cachedLedger: null,
      setSession: ({ slug, shortCode = "", msisdn = "", memberId = "", token, role, remember = true }) =>
        set({
          slug, shortCode, msisdn, memberId, token, role,
          rememberPhone: remember,
          expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000
        }),
      setLang: (lang) => set({ lang }),
      setCachedLedger: (cachedLedger) => set({ cachedLedger }),
      logout: () => set({ token: "", role: "", memberId: "", cachedLedger: null, expiresAt: 0 })
    }),
    { name: "stokvel-device-session", storage: createJSONStorage(() => idbStorage) }
  )
);