import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { chartData } from '../src/ui/chartData.js';

test('record tables search, sort, and page through configurable row counts', async () => {
  const dom=new JSDOM('<!doctype html><body></body>');
  const original=globalThis.document;globalThis.document=dom.window.document;
  try{
    const rows=Array.from({length:250},(_,index)=>({name:`Record ${index+1}`,amount:250-index}));
    const details=chartData(rows,[{key:'name'},{key:'amount'}],'Selected records');
    document.body.append(details);details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));
    assert.equal(details.querySelectorAll('tbody tr').length,100);
    details.querySelector('[aria-label="Rows per page"]').value='25';
    details.querySelector('[aria-label="Rows per page"]').dispatchEvent(new dom.window.Event('change'));
    assert.equal(details.querySelectorAll('tbody tr').length,25);
    details.querySelector('[aria-label="Sort by amount"]').click();
    assert.equal(details.querySelector('tbody tr td:nth-child(2)').textContent,'1');
    const search=details.querySelector('[aria-label="Search records in Selected records"]');
    search.value='Record 6';search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(details.querySelector('tbody').textContent.includes('Record 6'),true);
    const matches=rows.filter(row=>row.name.toLocaleLowerCase().includes('record 6')).length;
    assert.match(details.querySelector('[aria-live="polite"]').textContent,new RegExp(`of ${matches}`));
  }finally{globalThis.document=original;dom.window.close();}
});
