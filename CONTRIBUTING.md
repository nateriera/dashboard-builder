# Contributing

Small, focused contributions are welcome. Check existing issues before starting;
for larger changes, open an issue describing the problem and proposed approach.

## Run locally

Use Node 24 and desktop Google Chrome for browser checks:

```sh
npm ci
npm run dev
```

## Verify your change

```sh
npm test
npm run build
npm run test:browser
```

Browser tests start their own server on port 4173; close any existing server on
that port first. For documentation-only changes, check links, commands, and
claims against the current app; run app checks when behavior changes.

## Pull requests

- Keep each PR focused; explain the problem, resulting behavior, and validation.
- Include screenshots for visible changes and a regression test for bug fixes.
- Preserve exact data, explicit bindings, migration recovery, and export portability.
- Use synthetic or public sample data; never commit secrets or private uploads.
- Contributed templates must be original compositions. See the README's contracts.
- Start with an issue labeled **good first issue** if you are new to the project.

Publishing and deployment require separate owner authorization.
