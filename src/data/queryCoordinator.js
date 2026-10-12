// Serializes synchronization and execution, including calls arriving mid-sync.
export function createQueryCoordinator({ revision, collect, sync, execute }) {
  let tail = Promise.resolve(), synced = -1;
  const enqueue = task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  async function ensure() {
    while (synced !== revision()) {
      const captured = revision();
      await sync(collect());
      synced = captured;
    }
  }
  return {
    invalidate() { synced = -1; },
    ensure: () => enqueue(ensure),
    run: sql => enqueue(async () => {
      await ensure();
      const captured = revision();
      const result = await execute(sql);
      if (captured !== revision()) throw new Error('Datasets changed during query execution. Run again for current data.');
      return { ...result, revision: captured };
    })
  };
}

// Keep the serialized queue occupied until timeout cleanup has finished and
// route late results back to the timeout instead of returning them to callers.
export async function executeWithTimeout(operation, timeoutMs, onTimeout, message = 'Query timed out.') {
  let timer, timedOut = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      Promise.resolve().then(onTimeout).then(
        () => reject(new Error(message)),
        reject
      );
    }, timeoutMs);
  });
  const work = Promise.resolve().then(operation).then(
    result => timedOut ? timeout : result,
    error => timedOut ? timeout : Promise.reject(error)
  );
  try { return await Promise.race([work, timeout]); }
  finally { clearTimeout(timer); }
}

export function createPreviewGate(revision) {
  let token = 0, success = null;
  return {
    invalidate() { token++; success = null; },
    begin(sql) { success = null; return { token: ++token, sql, revision: revision() }; },
    accept(request, sql) {
      if (request.token !== token || request.sql !== sql || request.revision !== revision()) return false;
      success = request; return true;
    },
    eligible(sql) { return !!success && success.token === token && success.sql === sql && success.revision === revision(); }
  };
}
