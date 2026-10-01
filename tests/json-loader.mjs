// ESM loader so plain node can import the registry's JSON modules
// (vite resolves these natively; node needs the format hint).
import { readFile } from "fs/promises";

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".json")) {
    const source = await readFile(new URL(url), "utf8");
    return { format: "json", source, shortCircuit: true };
  }
  return next(url, context);
}
