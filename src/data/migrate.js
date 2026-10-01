// Source cleanup is permitted only after every destination record is verified.
export async function migrateLegacy({ storage, keys, db, ingest }) {
  const failures = [];
  for (const key of keys) {
    let raw;
    try {
      raw = storage.getItem(key);
      if (!raw) continue;
      const entries = JSON.parse(raw);
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Invalid legacy envelope');
      let complete = true;
      for (const [id,e] of Object.entries(entries)) {
        if (!e || !Array.isArray(e.rows)) { complete = false; continue; }
        ingest(id,e,false);
        try {
          if (!db) throw new Error('IndexedDB unavailable');
          const record = { ...e, id }; delete record.persisted;
          const existing = await db.get('datasets',id);
          if (existing && Object.keys(record).some(k => k !== 'bytes' && JSON.stringify(existing[k]) !== JSON.stringify(record[k]))) throw new Error('Destination collision');
          await db.put('datasets',record);
          const verified = await db.get('datasets',id);
          if (JSON.stringify(verified) !== JSON.stringify(record)) throw new Error('Read-back mismatch');
          ingest(id,verified,true);
        } catch { complete = false; }
      }
      if (complete) storage.removeItem(key);
      else failures.push(`${key}: migration incomplete; original retained`);
    } catch { failures.push(`${key}: migration failed; original retained`); }
  }
  return failures;
}
