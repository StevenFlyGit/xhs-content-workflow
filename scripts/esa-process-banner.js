// Injected at the top of routine/index.js via esbuild banner: the ESA Edge
// Routine runtime has no global `process` or `Buffer`, but bundled libraries
// reference them. Provide minimal, dependency-free shims.
var process = {
  env: {},
  version: '',
  versions: {},
  platform: 'browser',
  nextTick: function (cb) {
    queueMicrotask(cb)
  },
  emit: function () {
    return false
  },
  stdout: undefined,
  stderr: undefined,
}

// react-dom's server renderer checks `chunk instanceof Buffer` while
// streaming (byteLengthOfChunk). Provide a real class so instanceof works
// and falls through to the UTF-8 byte-length path; construction is unused.
var Buffer = class Buffer {
  static isBuffer() {
    return false
  }

  static from() {
    throw new Error('Buffer.from is not available in the ESA edge runtime.')
  }

  static alloc() {
    throw new Error('Buffer.alloc is not available in the ESA edge runtime.')
  }

  static byteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength
  }
}
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}
