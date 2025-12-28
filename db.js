// db.js — IndexedDB (offline-first, estável)
const DB_NAME = "btx_premium_clean_db";
const DB_VER = 1;

const STORES = {
  profissionais: "profissionais",
  agenda: "agenda",
  fichas: "fichas"
};

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.profissionais)){
        const st = db.createObjectStore(STORES.profissionais, { keyPath:"id" });
        st.createIndex("by_nome", "nome", { unique:false });
      }

      if (!db.objectStoreNames.contains(STORES.agenda)){
        const st = db.createObjectStore(STORES.agenda, { keyPath:"id" });
        st.createIndex("by_prof_data", ["profId","dataISO"], { unique:false });
      }

      if (!db.objectStoreNames.contains(STORES.fichas)){
        const st = db.createObjectStore(STORES.fichas, { keyPath:"id" });
        st.createIndex("by_prof_data", ["profId","dataISO"], { unique:false });
        st.createIndex("by_paciente", "pacienteKey", { unique:false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(store, key){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(store, key){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll(store){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
