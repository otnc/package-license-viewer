import Module from "node:module";
import { vscodeShim } from "./vscodeShim";

type Loader = (request: string, ...rest: unknown[]) => unknown;

/**
 * Makes `require("vscode")` resolve to the shim instead of failing, for every module loaded from here on — `config.ts` and `log.ts` still import `vscode` for real. Must be the very first thing this process imports, before anything that transitively requires those two modules; import ordering in the compiled CommonJS output makes that true as long as this stays the first `import` in `index.ts`.
 */
const patchable = Module as unknown as { _load: Loader };
const originalLoad = patchable._load;
patchable._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
  if (request === "vscode") {
    return vscodeShim;
  }
  return originalLoad.apply(this, [request, ...rest]);
};
