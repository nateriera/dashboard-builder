/** Read our embedded JSON backup without constructing an HTML document.
 * Imported markup/scripts/resources are never executed or loaded. */
export function decodeLayoutFile(fileName, text) {
  if(!/\.html?$/i.test(fileName)) return JSON.parse(text);
  const script=/<script\b(?=[^>]{0,1000}\bid\s*=\s*["']dashboard-data["'])(?=[^>]{0,1000}\btype\s*=\s*["']application\/json["'])[^>]{0,1000}>([\s\S]*?)<\/script\s*>/i.exec(text);
  if(!script) throw new Error('HTML does not contain a Dashboard Builder JSON backup.');
  const payload=JSON.parse(script[1]);
  if(payload?.app!=='dashboard-builder'||payload.kind!=='dashboard-export'||!payload.layout) throw new Error('This HTML has no editable layout backup. Import its layout JSON instead.');
  return payload.layout;
}
