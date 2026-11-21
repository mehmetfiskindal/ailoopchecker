---
name: ailoopchecker-geatsc-dev
description: >-
  Develop, build, debug, and verify TypeScript changes in ailoopchecker for AOT
  compilation to a native C++ ELF binary with geatsc and @geastack/node-compat.
  Use when editing src/**/*.ts, fixing geatsc emission refusals or C++ link
  errors, adding Node APIs, or verifying Node.js vs native binary parity.
---

# ailoopchecker geatsc Development Workflow

Use this runbook whenever modifying TypeScript code in `ailoopchecker` to keep **0 emission refusals**, **zero network/disk leaks**, and **exact parity** between Node.js 22+ and `./dist/ailoopchecker`.

## Non-Negotiable Constraints

Read [references/geatsc-constraints.md](./references/geatsc-constraints.md) for the full table of supported APIs and failure modes. Summary of hard rules:

1. **Relative imports MUST end with `.ts`** (e.g. `import { clamp } from './bytes.ts'`). Both Node 22 type-stripping and `geatsc` require this.
2. **Strict static typing everywhere:** No `any`, no untyped records, no dynamic property bags on hot paths. Keep fields and return types explicit.
3. **Allowed `node:*` imports only:** `node:fs` (`promises.readFile`, `statSync`, `existsSync`), `node:path`, `node:crypto`, `node:buffer`, `node:process` (`env`).
4. **Forbidden imports:**
   - Never import `node:zlib` (triggers `libbrotlidec` linkage and CVE version gate); use pure TypeScript `inflateZlib` in `src/inflate.ts`.
   - Never import `node:http`, `node:https`, `node:net`, `node:dns`, or `node:child_process` (violates offline/read-only privacy model and/or unimplemented in `node-compat`).
   - Never use `fs.readFileSync` or `fs.readdirSync` (not implemented in `node-compat`).
5. **No multi-arg `JSON.stringify(obj, null, 2)` on typed records:** `geatsc` refuses replacer/pretty-print over static record carriers. Extend the deterministic serializer in `src/product/report.ts` instead.
6. **Keep `processEnv` and `URL` guard in `src/product/cli.ts`:** Read env vars via `import { env as processEnv } from 'node:process'` (not global `process.env`) and keep the `URL` reference so `node-compat` mounts `whatwg-url.ts` for `node:fs` signatures.
7. **Avoid `O(N²)` UTF-8 string loops on large files:** Never run `charCodeAt(i)`, `toLowerCase()`, or complex `RegExp` over multi-KB buffers in hot paths; use `Uint8Array` byte loops and `indexOfUtf8CI` in `src/shared/bytes.ts`.

## Standard Edit → Build → Parity Verification Loop

Run after every code change:

```bash
# 1. Verify TypeScript logic and 7/7 synthetic forensic tests under Node.js 22
npm test

# 2. Compile TypeScript -> C++ -> native binary (dist/ailoopchecker)
npm run build

# 3. Verify identical verdicts and scores on the native ELF binary
npm run test:native
```

Optional fast debug build (faster C++ compile with `-O0 -g`):

```bash
npm run build:debug
```

## Diagnosing Build Failures

1. **Emission refusal or missing obligation:** Inspect `dist/.geatsc/ailoopchecker/report.json` or re-run `node scripts/build-native.mjs --emit-only` to isolate the exact file, line, and refused operation.
2. **C++ compiler selection:** `scripts/build-native.mjs` auto-selects `clang++` if available, else `g++`. Override with `CXX=g++ npm run build` if needed.
3. **Privacy / linkage check:** Confirm no unexpected shared libraries were introduced:

```bash
ldd dist/ailoopchecker
```

Expected shared libraries: `libcrypto`, `libstdc++`, `libm`, `libgcc_s`, `libc` (plus indirect system deps of `libcrypto`). Never `libbrotlidec` or networking libraries.
