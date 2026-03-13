export interface HistoricalDecision {
  packageDesc: string;
  status: 'FLAGGED' | 'CLEARED';
  timestamp: number;
}

const DB_NAME = 'BondingPreAlertDB';
const STORE_NAME = 'historical_decisions';

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'packageDesc' });
      }
    };
  });
};

export const saveDecision = async (packageDesc: string, status: 'FLAGGED' | 'CLEARED'): Promise<void> => {
  if (!packageDesc) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const decision: HistoricalDecision = {
      packageDesc: packageDesc.trim().toLowerCase(),
      status,
      timestamp: Date.now()
    };

    const request = store.put(decision);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getDecision = async (packageDesc: string): Promise<HistoricalDecision | null> => {
  if (!packageDesc) return null;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const request = store.get(packageDesc.trim().toLowerCase());
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const getAllDecisions = async (): Promise<HistoricalDecision[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};
