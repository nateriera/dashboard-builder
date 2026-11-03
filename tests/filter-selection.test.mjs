import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', {url:'https://localhost/'});
globalThis.document=dom.window.document; globalThis.window=dom.window;
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0); globalThis.cancelAnimationFrame=clearTimeout;
globalThis.ResizeObserver=class {observe(){} disconnect(){}};
globalThis.MutationObserver=dom.window.MutationObserver;
const {toggleFiltersPopover,closeFiltersPopover}=await import('../src/ui/filtersPopover.js');
const tiles=[{id:'source',title:'Records',pageId:'page-1',fields:[{field:'category',type:'category',values:[null,'',1,'1','A'],truncated:false}]}];
function open(filters,onFiltersChange) {
  const anchor=document.createElement('button');document.body.append(anchor);
  toggleFiltersPopover({anchor,filters,parameters:[],tiles,pages:[{id:'page-1',name:'Page 1'}],tileTitle:()=> 'Records',onFiltersChange,onParametersChange(){}});
}
function click(text) { const button=[...document.querySelectorAll('button')].find(button=>button.textContent===text); assert.ok(button,text);button.click(); }
function toggle(value,checked) {
  const input=[...document.querySelectorAll('.filter-value input')][tiles[0].fields[0].values.findIndex(item=>Object.is(item,value))];
  assert.ok(input,`checkbox ${JSON.stringify(value)}`);input.checked=checked;input.dispatchEvent(new dom.window.Event('change'));
}

test('category toggles preserve typed values across multiple selections and removals', () => {
  let saved;open([],value=>saved=value);
  try {
    click('Add filter');const field=document.querySelector('[aria-label="Filter field"]');field.value='category';field.dispatchEvent(new dom.window.Event('change'));
    toggle(null,true);toggle('',true);toggle(1,true);toggle('1',true);toggle(null,false);
    click('Apply filter');assert.deepEqual(saved[0].values,['',1,'1']);
  } finally {closeFiltersPopover();}
});

test('existing category edits initialize checked values, replace the same filter, and preserve its scope', () => {
  const filter={id:'kept',field:'category',op:'is-not',values:['A'],scope:'page',pageId:'page-1'};
  let saved;open([filter],value=>saved=value);
  try {
    document.querySelector('[aria-label="Edit category filter"]').click();
    const checks=[...document.querySelectorAll('.filter-value input')];
    assert.equal(checks[4].checked,true);
    assert.equal(checks[3].checked,false);
    assert.equal(document.querySelector('[aria-label="Filter match"]').value,'is-not');
    toggle('1',true);toggle('A',false);click('Apply filter');
    assert.deepEqual(saved,[{...filter,values:['1']}]);
  } finally {closeFiltersPopover();}
});
