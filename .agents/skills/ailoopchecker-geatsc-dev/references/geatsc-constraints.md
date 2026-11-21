# geatsc & @geastack/node-compat Reference for ailoopchecker

## Supported Builtin Surface Used by This Repo

| Module | Verified Working APIs | Avoid / Unsupported |
| --- | --- | --- |
| `node:fs` | `promises.readFile`, `statSync`, `existsSync`, `promises.stat`, `promises.access` | `readFileSync`, `readdirSync`, any write APIs |
| `node:process` | `import { env } from 'node:process'`; global `process.argv`, `process.exit` | Global `process.env[...]` (`native-boundary:ProcessEnv@1` missing) |
| `node:crypto` | `createHash('sha256').update(buf).digest('hex')` | `createCipheriv`, `createSign` (not implemented) |
| `node:buffer` | `Buffer.from`, `Buffer.alloc`, `Buffer.concat`, `.subarray`, `.toString('utf8')` | Dynamic `unknown` casts across Buffer/TypedArray unions |
| `node:path` | `basename`, `extname`, `resolve`, `join` | — |
| Pure TS globals | `Uint8Array`, `Float64Array`, `Int32Array`, `Set<T>`, `Map<K,V>`, `Math`, `performance.now()` | `eval`, `Proxy`, `Reflect`, 3-arg `JSON.stringify(obj, null, 2)` |

## Common `geatsc` Errors & Fixes

### 1. `Cannot find name 'URL'` inside `@geastack/node-compat/runtime/node/fs.ts`
- **Cause:** `node-compat`'s reachability pass only injects `whatwg-url.ts` if the user program references `URL`.
- **Fix:** Keep `const _keepUrlGlobal: typeof URL | undefined = typeof URL !== 'undefined' ? URL : undefined; void _keepUrlGlobal` in `src/cli.ts`.

### 2. `native-boundary obligation native-boundary:ProcessEnv@1 is missing`
- **Cause:** Reading `process.env[...]` off the ambient global `process` interface.
- **Fix:** Use `import { env as processEnv } from 'node:process'` and index `processEnv[...]`.

### 3. `cpp emission refuses to lower "host-member-call:JSON.stringify"`
- **Cause:** Passing replacer/indent arguments (`JSON.stringify(val, null, 2)`) for a statically typed record.
- **Fix:** Serialize explicitly with string helpers in `src/report.ts`.

### 4. `libbrotlidec ... is affected by CVE-...` during link
- **Cause:** Importing anything from `node:zlib` pulls in `gea_node_brotli.hpp`.
- **Fix:** Use `inflateZlib` / `zlibWrapUncompressed` from `src/inflate.ts`.
