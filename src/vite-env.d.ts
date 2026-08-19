/// <reference types="vite/client" />

/*
 * Vite's ambient types, pulled in explicitly.
 *
 * `tsconfig.json` pins `types` to `vitest/globals`, which switches off automatic
 * `@types` discovery -- so `import url from './track.webm?url'` would otherwise
 * be an untyped module. A triple-slash reference is honoured regardless of that
 * list, which keeps the pin (deliberate: it stops stray `@types` packages
 * leaking globals into a strict build) while still typing the asset queries.
 */
