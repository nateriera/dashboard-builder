import { LIMITS } from './limits.js';
export function readUpload(file, container) {
  if (file.size > LIMITS.fileBytes) return Promise.reject(new Error('File limit is 16 MiB. Split or aggregate the file.'));
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./parse.worker.js',import.meta.url),{ type: 'module' });
    const row = document.createElement('div'), status = document.createElement('span'), cancel = document.createElement('button');
    status.setAttribute('role','status'); cancel.type = 'button'; cancel.textContent = 'Cancel upload';
    row.append(status,cancel); container.append(row);
    const observer = new MutationObserver(() => { if (!container.isConnected) finish(new Error('Upload cancelled.')); });
    observer.observe(document.body,{ childList: true, subtree: true });
    let settled = false;
    function finish(err,result) {
      if (settled) return; settled = true; worker.terminate(); observer.disconnect(); row.remove();
      if (err) reject(err); else resolve(result);
    }
    cancel.onclick = () => finish(new Error('Upload cancelled.'));
    worker.onmessage = ({ data }) => {
      if (data.progress) status.textContent = data.progress;
      else finish(data.error ? new Error(data.error) : null,data.result);
    };
    worker.onerror = e => finish(new Error(e.message || 'Upload worker failed.'));
    worker.postMessage(file);
  });
}
