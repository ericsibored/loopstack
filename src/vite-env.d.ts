/// <reference types="vite/client" />

/**
 * The rnnoise package ships no type declarations and no `exports` map, so the
 * deep import needs describing by hand. The factory resolves once the wasm
 * module is instantiated; `wasmBinary` lets us supply the bytes ourselves,
 * which is required inside a module worker (see denoise.worker.ts).
 */
declare module '@jitsi/rnnoise-wasm/dist/rnnoise' {
  interface RNNWasmOptions {
    wasmBinary?: ArrayBuffer;
    locateFile?: (path: string) => string;
  }
  const createRNNWasmModule: (options?: RNNWasmOptions) => Promise<unknown>;
  export default createRNNWasmModule;
}
