import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { chartData } from '../src/ui/chartData.js';
import { retainSourceRows, sourceRowsFor } from '../src/data/rowProvenance.js';

test('source provenance follows composite row identity through filtering and sorting', () => {
  const source = [{label:'Original A',region:'A',value:'12'},{label:'Original B',region:'B',value:'7'}];
  const composite = source.map(row => ({...row,label:row.region,value:Number(row.value)}));
  assert.equal(retainSourceRows(composite,source), composite);
  assert.deepEqual(sourceRowsFor([composite[1],composite[0]]), [source[1],source[0]]);
  assert.equal(composite[0].label, 'A');
  assert.equal(composite[0].value, 12);
  assert.equal(source[0].value, '12');
  const ordinary = [{label:'Unmapped'}];
  assert.equal(sourceRowsFor(ordinary), ordinary);
});

test('record tables present original values and source columns while composites retain mapped fields', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const original = globalThis.document; globalThis.document = dom.window.document;
  try {
    const rows = retainSourceRows([{label:'Mapped',value:12,synthetic:'chart'}], [{label:'Original',region:'Mapped',value:'12',extra:'Kept'}]);
    const details = chartData(rows,[{key:'label'},{key:'value'},{key:'synthetic'}],'Source');
    document.body.append(details); details.open = true; details.dispatchEvent(new dom.window.Event('toggle'));
    assert.deepEqual([...details.querySelectorAll('thead button')].map(button=>button.textContent), ['label','region','value','extra']);
    assert.deepEqual([...details.querySelectorAll('tbody td')].map(cell=>cell.textContent), ['Original','Mapped','12','Kept']);
    assert.equal(rows[0].label, 'Mapped');
    assert.equal(rows[0].value, 12);
  } finally { globalThis.document = original; dom.window.close(); }
});

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
