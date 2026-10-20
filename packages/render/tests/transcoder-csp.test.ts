// SPDX-License-Identifier: Apache-2.0
// The Basis transcoder under the CSP of the app. The CSP has no 'unsafe-eval' and has `require-trusted-types-for
// 'script'`, so the browser blocks `new Function` and `eval`. The transcoder copy of
// packages/assets/src/build/patchBasis.ts has no such call. This test blocks the Function constructor and eval, starts
// a new transcoder module and transcodes ETC1S and UASTC files.
import { afterEach, describe, expect, it } from "bun:test";
import type { KTX2LoaderWorkerConfig } from "three/examples/jsm/loaders/KTX2Loader.js";
import { loadBasisModule, transcodeKtx2 } from "../src/ktx2";
import { basisWasm, sampleKtx2 } from "./fixtures";

const RGBA_ONLY: KTX2LoaderWorkerConfig = {
  astcSupported: false,
  astcHDRSupported: false,
  etc1Supported: false,
  etc2Supported: false,
  dxtSupported: false,
  bptcSupported: false,
  pvrtcSupported: false,
};

const realFunction = globalThis.Function;
const realEval = globalThis.eval;

afterEach(() => {
  globalThis.Function = realFunction;
  globalThis.eval = realEval;
});

describe("Basis transcoder without dynamic code", () => {
  it("starts and transcodes while new Function and eval throw, as under the CSP", async () => {
    // The test files come first: the Basis encoder of the tests uses dynamic code itself.
    const files = [await sampleKtx2(false), await sampleKtx2(true)];
    const blocked: string[] = [];
    globalThis.Function = new Proxy(realFunction, {
      construct: () => {
        blocked.push("new Function");
        throw new EvalError("blocked by the test CSP");
      },
      apply: () => {
        blocked.push("Function()");
        throw new EvalError("blocked by the test CSP");
      },
    });
    globalThis.eval = () => {
      blocked.push("eval");
      throw new EvalError("blocked by the test CSP");
    };
    const module = await loadBasisModule(basisWasm());
    for (const file of files) {
      const result = transcodeKtx2(module, file, RGBA_ONLY);
      expect(result.faces[0]?.mipmaps[0]?.data.byteLength).toBe(64 * 32 * 4);
    }
    expect(blocked).toEqual([]);
  });
});
