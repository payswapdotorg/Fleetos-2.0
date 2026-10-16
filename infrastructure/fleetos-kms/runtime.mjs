/**
 * infrastructure/fleetos-kms/runtime.mjs — the import-time bootstrap that
 * registers the resolve hooks (F373; the F351A/F370C precedent).
 *
 * Usage:
 *   node --experimental-transform-types --no-warnings \
 *        --import ./runtime.mjs service.ts
 *
 * Pure node: builtins (node:module). See hooks.mjs for what the hooks do.
 */

import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
