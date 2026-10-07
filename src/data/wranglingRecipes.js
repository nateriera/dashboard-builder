const KEY = 'dashbuilder.wrangling-recipes.v1';
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

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
  }
  return recipe;
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
