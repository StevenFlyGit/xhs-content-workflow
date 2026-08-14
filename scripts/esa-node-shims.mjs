// Edge-runtime shims for node:* builtins referenced by the SSR bundle.
// ESA Edge Routine rejects the `node:` module scheme, and these imports only
// back code paths that are either unreachable on edge or safely degradable.

// --- node:module ---------------------------------------------------------
// createRequire is invoked at module-init time by the rolldown runtime
// (`__require = createRequire(import.meta.url)`), and bundled CJS polyfills
// call __require("util"|"stream"|"buffer"|"events") during their own init.
// On Node (smoke tests) delegate to the real require; on edge return
// tolerant stubs so init-time member access does not crash. Any stub that is
// actually *invoked* at edge runtime throws with a clear message.
class StubEventEmitter {
  constructor() {
    this._handlers = new Map()
  }

  on() { return this }
  once() { return this }
  off() { return this }
  removeListener() { return this }
  addListener() { return this }
  emit() { return false }
  removeAllListeners() { return this }
  setMaxListeners() { return this }
  listenerCount() { return 0 }
}

function notAvailable(name, member) {
  return function unavailable() {
    throw new Error(`${name}.${member} is not available in the ESA edge runtime.`)
  }
}

function stubUtil() {
  const inspect = (value) => {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }
  inspect.colors = {}
  inspect.styles = {}
  return {
    inspect,
    format: (...args) => args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' '),
    deprecate: (fn) => fn,
    promisify: (fn) => fn,
    inherits: () => {},
    debuglog: () => () => {},
    types: {
      isDate: (v) => v instanceof Date,
      isRegExp: (v) => v instanceof RegExp,
      isPromise: (v) => Boolean(v && typeof v.then === 'function'),
    },
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  }
}

function stubBuffer() {
  return {
    Buffer: {
      isBuffer: () => false,
      from: notAvailable('Buffer', 'from'),
      alloc: notAvailable('Buffer', 'alloc'),
      concat: notAvailable('Buffer', 'concat'),
      byteLength: (v) => new TextEncoder().encode(String(v)).byteLength,
    },
    INSPECT_MAX_BYTES: 50,
    kMaxLength: 0,
  }
}

function stubStream() {
  return {
    PassThrough,
    Readable,
    Writable: Readable,
    Duplex: Readable,
    Transform: Readable,
    Stream: Readable,
    pipeline: notAvailable('stream', 'pipeline'),
  }
}

function stubCrypto() {
  const web = globalThis.crypto
  return {
    ...web,
    getRandomValues: web.getRandomValues.bind(web),
    randomUUID: web.randomUUID ? web.randomUUID.bind(web) : notAvailable('crypto', 'randomUUID'),
    subtle: web.subtle,
    createHash: notAvailable('crypto', 'createHash'),
    createHmac: notAvailable('crypto', 'createHmac'),
    randomBytes: notAvailable('crypto', 'randomBytes'),
  }
}

const REQUIRE_STUBS = {
  util: stubUtil,
  buffer: stubBuffer,
  stream: stubStream,
  'node:stream': stubStream,
  events: () => ({ EventEmitter: StubEventEmitter }),
  crypto: stubCrypto,
  'node:crypto': stubCrypto,
  async_hooks: () => ({ AsyncLocalStorage }),
  'node:async_hooks': () => ({ AsyncLocalStorage }),
}

export function createRequire() {
  // Node smoke tests get the real module system.
  if (typeof process !== 'undefined' && globalThis.__ESA_SHIM_USE_NATIVE_REQUIRE__) {
    return globalThis.__ESA_SHIM_USE_NATIVE_REQUIRE__
  }
  return function require(specifier) {
    const stub = REQUIRE_STUBS[specifier]
    if (stub) return stub()
    throw new Error(`Cannot require "${specifier}" in the ESA edge runtime.`)
  }
}

// --- node:stream/web ------------------------------------------------------
// The edge runtime already exposes the WHATWG streams globals.
export const ReadableStream = globalThis.ReadableStream
export const WritableStream = globalThis.WritableStream
export const TransformStream = globalThis.TransformStream

// --- node:stream ----------------------------------------------------------
// PassThrough/Readable are only used behind the renderToPipeableStream branch
// (Node-only); edge rendering goes through renderToReadableStream instead.
export class PassThrough {
  constructor() {
    throw new Error('node:stream PassThrough is not available in the ESA edge runtime.')
  }
}
export class Readable {}

// --- node:async_hooks -----------------------------------------------------
// Prefer a runtime-provided AsyncLocalStorage when the edge exposes one;
// otherwise fall back to a minimal sequential shim: per-request context
// tracking that is safe for requests running to completion but NOT safe for
// interleaved concurrency.
class SequentialAsyncLocalStorage {
  #current

  getStore() {
    return this.#current
  }

  run(store, callback, ...args) {
    const previous = this.#current
    this.#current = store
    try {
      const result = callback(...args)
      if (result && typeof result.then === 'function') {
        return result.finally(() => {
          this.#current = previous
        })
      }
      this.#current = previous
      return result
    } catch (error) {
      this.#current = previous
      throw error
    }
  }

  enterWith(store) {
    this.#current = store
  }

  disable() {
    this.#current = undefined
  }
}

export const AsyncLocalStorage = globalThis.AsyncLocalStorage ?? SequentialAsyncLocalStorage

export default {
  createRequire,
  ReadableStream,
  WritableStream,
  TransformStream,
  PassThrough,
  Readable,
  AsyncLocalStorage,
}
