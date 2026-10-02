import { parseFile } from './parse.js';
import { profileRows } from './profile.js';
self.onmessage = async ({ data: file }) => {
  try {
    self.postMessage({ progress: 'Reading file…' });
    const text = await file.text();
    self.postMessage({ progress: 'Parsing and validating…' });
    const parsed = parseFile(file.name,text);
    self.postMessage({ progress: 'Profiling columns…' });
    const profile = profileRows(parsed.columns,parsed.rows);
    self.postMessage({ result: { ...parsed, profile } });
  } catch (err) { self.postMessage({ error: err.message }); }
};
