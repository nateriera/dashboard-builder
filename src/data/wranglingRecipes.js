const KEY = 'dashbuilder.wrangling-recipes.v1';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const PORTABLE_FORMAT = 'dashboard-builder-wrangling-recipes';

function validText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid recipe ${label}.`);
  return value.trim();
}

export function validateWranglingRecipe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid wrangling recipe.');
  if (!ID.test(input.id || '') || !['pivot','formula'].includes(input.kind)) throw new Error('Invalid wrangling recipe.');
  const recipe={id:input.id,name:validText(input.name,'name',80),kind:input.kind};
  if (input.kind==='pivot') {
    if (!Array.isArray(input.groups)||input.groups.length>20||!Array.isArray(input.aggregations)||input.aggregations.length>20||(!input.groups.length&&!input.aggregations.length)) throw new Error('Invalid pivot recipe steps.');
    recipe.groups=input.groups.map(group=>{
      const bin=group?.bin||null;
      if(bin!==null&&!['month','quarter','year'].includes(bin))throw new Error('Invalid recipe date bin.');
      return {column:validText(group?.column,'grouping column'),bin};
    });
    recipe.aggregations=input.aggregations.map(aggregate=>{
      const operation=validText(aggregate?.operation,'aggregation').toUpperCase();
      if(!['COUNT','COUNT DISTINCT','SUM','AVG','MIN','MAX'].includes(operation))throw new Error('Invalid recipe aggregation.');
      return {column:validText(aggregate?.column,'aggregation column'),operation,name:validText(aggregate?.name,'output name')};
    });
  } else {
    recipe.formula=validText(input.formula,'formula',2000);
    if(/;|--|\/\*/.test(recipe.formula))throw new Error('Invalid recipe formula.');
    recipe.outputName=validText(input.outputName,'output name',128);
    if(input.columns!==undefined){
      if(!Array.isArray(input.columns)||input.columns.length>100||input.columns.some(column=>typeof column!=='string'||!column.trim())||new Set(input.columns).size!==input.columns.length)throw new Error('Invalid formula recipe columns.');
      recipe.columns=input.columns.map(column=>validText(column,'formula column',200));
    }
  }
  return recipe;
}

export function serializePortableWranglingRecipes(input) {
  if(!Array.isArray(input)||!input.length||input.length>25)throw new Error('Choose between 1 and 25 recipes to export.');
  const recipes=input.map(validateWranglingRecipe);
  return JSON.stringify({format:PORTABLE_FORMAT,version:1,recipes},null,2);
}

export function formulaReferencedColumns(formula,availableColumns){
  const available=new Set(availableColumns);
  return [...new Set(formulaIdentifiers(formula).filter(column=>available.has(column)))];
}

export function recipeFormulaIdentifiers(formula){return formulaIdentifiers(formula);}

export function parsePortableWranglingRecipes(text) {
  if(typeof text!=='string'||text.length>1024*1024)throw new Error('Recipe file is empty or exceeds 1 MiB.');
  let data;try{data=JSON.parse(text);}catch{throw new Error('Recipe file is not valid JSON.');}
  if(data?.format!==PORTABLE_FORMAT||data.version!==1||!Array.isArray(data.recipes)||!data.recipes.length||data.recipes.length>25)throw new Error('Unsupported wrangling recipe format or version.');
  const recipes=data.recipes.map(validateWranglingRecipe),names=new Set();
  for(const recipe of recipes){const name=recipe.name.toLocaleLowerCase();if(names.has(name))throw new Error('Recipe file contains duplicate names.');names.add(name);}
  return recipes;
}

export function mapWranglingRecipeColumns(input,mapping,availableColumns) {
  const recipe=validateWranglingRecipe(input);
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||!Array.isArray(availableColumns))throw new Error('Invalid recipe column mapping.');
  const columns=recipe.kind==='pivot'
    ?[...new Set([...recipe.groups.map(group=>group.column),...recipe.aggregations.map(item=>item.column)])]
    :[...new Set(recipe.columns?.length?recipe.columns:formulaIdentifiers(recipe.formula))];
  const result=structuredClone(recipe);
  for(const source of columns){
    const target=mapping[source]??(availableColumns.includes(source)?source:null);
    if(typeof target!=='string'||!availableColumns.includes(target))throw new Error(`Map “${source}” to one of the available columns.`);
    if(recipe.kind==='pivot'){
      result.groups.forEach(group=>{if(group.column===source)group.column=target;});
      result.aggregations.forEach(item=>{if(item.column===source)item.column=target;});
    }else{
      result.formula=replaceFormulaIdentifier(result.formula,source,target);
      result.columns=(result.columns||columns).map(column=>column===source?target:column);
    }
  }
  return result;
}

function formulaIdentifiers(formula){
  const found=[];const pattern=/"((?:[^"]|"")*)"|'(?:[^']|'')*'|([A-Za-z_][A-Za-z0-9_]*)/g;
  for(const match of formula.matchAll(pattern)){
    if(match[1]!==undefined)found.push(match[1].replaceAll('""','"'));
    else if(match[2]&&!/^\s*\(/.test(formula.slice(match.index+match[0].length)))found.push(match[2]);
  }
  return [...new Set(found)];
}
function replaceFormulaIdentifier(formula,source,target){
  const quote=value=>`"${value.replaceAll('"','""')}"`;
  const pattern=/"((?:[^"]|"")*)"|'(?:[^']|'')*'|([A-Za-z_][A-Za-z0-9_]*)/g;
  return formula.replace(pattern,(token,quoted,bare)=>{
    if(quoted!==undefined&&quoted.replaceAll('""','"')===source)return quote(target);
    if(bare===source)return quote(target);
    return token;
  });
}

export function importWranglingRecipes(input) {
  const incoming=Array.isArray(input)?input:parsePortableWranglingRecipes(input);
  const current=listWranglingRecipes(),names=new Set(current.map(recipe=>recipe.name.toLocaleLowerCase()));
  if(current.length+incoming.length>25)throw new Error('Recipe library is full (25 recipes). Remove one before importing.');
  const merged=[...current];
  for(const item of incoming){
    let recipe=validateWranglingRecipe(item),base=recipe.name,name=base,suffix=2;
    while(names.has(name.toLocaleLowerCase()))name=`${base} (${suffix++})`;
    names.add(name.toLocaleLowerCase());
    recipe={...recipe,id:`recipe-${globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}`,name};
    merged.push(recipe);
  }
  try{localStorage.setItem(KEY,JSON.stringify(merged));}catch{throw new Error('Could not import recipes in this browser.');}
  return merged;
}

export function listWranglingRecipes() {
  try {
    const parsed=JSON.parse(localStorage.getItem(KEY)||'[]');
    if(!Array.isArray(parsed))return [];
    return parsed.slice(0,25).flatMap(item=>{try{return [validateWranglingRecipe(item)];}catch{return [];}});
  } catch { return []; }
}

export function saveWranglingRecipe(input) {
  const recipe=validateWranglingRecipe(input);
  const current=listWranglingRecipes();
  if(current.some(item=>item.name.toLocaleLowerCase()===recipe.name.toLocaleLowerCase())) throw new Error('A recipe with that name already exists.');
  if(current.length>=25)throw new Error('Recipe library is full (25 recipes). Remove one before saving another.');
  const next=[...current,recipe];
  try { localStorage.setItem(KEY,JSON.stringify(next)); }
  catch { throw new Error('Could not save the recipe in this browser.'); }
  return recipe;
}

export function removeWranglingRecipe(id) {
  const current=listWranglingRecipes();
  const next=current.filter(recipe=>recipe.id!==id);
  if(next.length===current.length)return false;
  try { localStorage.setItem(KEY,JSON.stringify(next)); }
  catch { throw new Error('Could not update the recipe library in this browser.'); }
  return true;
}
