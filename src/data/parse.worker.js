import { parseFile } from './parse.js';
self.onmessage = async ({ data: file }) => {
  try {
    self.postMessage({ progress: 'Reading file…' });
    const text = await file.text();
    self.postMessage({ progress: 'Parsing and validating…' });
    self.postMessage({ result: parseFile(file.name,text) });
  } catch (err) { self.postMessage({ error: err.message }); }
};
