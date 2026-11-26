import { create } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";

const idbStorage: StateStorage = {
  getItem: async (name) => new Promise((resolve) => {
    const req = indexedDB.open("stokvel_ledger_db", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readonly");
      const g = tx.objectStore("kv").get(name);
      g.onsuccess = () => resolve(g.result ?? null);
      g.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  }),
  setItem: async (name, value) => new Promise((resolve) => {
    const req = indexedDB.open("stokvel_ledger_db", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, name);
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => resolve();
  }),
  removeItem: async (name) => new Promise((resolve) => {
    const req = indexedDB.open("stokvel_ledger_db", 1);
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
  token: string;
  role: "TREASURER" | "MEMBER" | "";
  cachedLedger: any | null;
  setSession: (slug: string, token: string, role: "TREASURER" | "MEMBER") => void;
  setCachedLedger: (data: any) => void;
  logout: () => void;
}

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set) => ({
      slug: "",
      token: "",
      role: "",
      cachedLedger: null,
      setSession: (slug, token, role) => set({ slug, token, role }),
      setCachedLedger: (cachedLedger) => set({ cachedLedger }),
      logout: () => set({ token: "", role: "", cachedLedger: null })
    }),
    { name: "stokvel-ledger-cache", storage: createJSONStorage(() => idbStorage) }
  )
);
