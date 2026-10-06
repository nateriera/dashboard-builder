import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryCoordinator } from '../src/data/queryCoordinator.js';

test('detailed DuckDB queries are serialized and rejected after source revision changes', async () => {
  let revision = 1;
  let finish;
  const coordinator = createQueryCoordinator({
    revision: () => revision,
    collect: () => ['table'],
    sync: async () => {},
    execute: async sql => ({ columns: [sql], rows: [] }),
    executeDetailed: async sql => {
      if (sql === 'slow') await new Promise(resolve => { finish = resolve; });
      return { columns: ['x'], rows: [], types: { x: 'DOUBLE' } };
    }
  });
  assert.deepEqual(await coordinator.runDetailed('fast'), { columns: ['x'], rows: [], types: { x: 'DOUBLE' }, revision: 1 });
  const pending = coordinator.runDetailed('slow');
  await new Promise(resolve => setImmediate(resolve));
  revision++;
  finish();
  await assert.rejects(pending, /datasets changed during query execution/i);
});
