export function resolveTileTitle(requestedTitle, defaultTitle, existingTitles) {
  if (requestedTitle != null) return requestedTitle;

  const used = new Set(existingTitles);
  if (!used.has(defaultTitle)) return defaultTitle;

  let suffix = 2;
  while (used.has(`${defaultTitle} ${suffix}`)) suffix++;
  return `${defaultTitle} ${suffix}`;
}
