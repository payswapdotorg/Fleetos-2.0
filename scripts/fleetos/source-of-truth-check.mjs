import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const required = [
  "FLEETOS-SOURCE-OF-TRUTH.md",
  "AGENTS.md",
  "spec/ARCHITECTURE-LOCK.md",
  "spec/BOUNDED-CONTEXTS.md",
  "spec/DEPENDENCY-GRAPH.md",
  "spec/worker-ownership.yaml",
  "spec/work-items/WORK-ITEM-CATALOG.md",
  "docs/tech-lead/FINAL-HANDOFF.md",
  "docs/tech-lead/CONCURRENCY-PROTOCOL.md",
  "AI_CONTINUATION.md",
];

const failures = [];
for (const file of required) {
  try { await access(join(root, file)); }
  catch { failures.push(`missing canonical file: ${file}`); }
}

let packageJson;
try {
  packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (packageJson.name !== "fleetos-2.0") failures.push(`package.json name must be fleetos-2.0 (found ${packageJson.name})`);
  if (packageJson.fleetosArchitecture !== "2.0.0") failures.push("package.json fleetosArchitecture must be 2.0.0");
  if (packageJson.fleetosSourceOfTruth !== "FLEETOS-SOURCE-OF-TRUTH.md") failures.push("package.json fleetosSourceOfTruth is incorrect");
} catch (error) {
  failures.push(`cannot parse package.json: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const ownership = await readFile(join(root, "spec/worker-ownership.yaml"), "utf8");
  for (const worker of ["worker-a:", "worker-b:", "worker-c:", "tl:"]) {
    if (!ownership.includes(worker)) failures.push(`worker ownership missing ${worker}`);
  }
  const count = (ownership.match(/^  worker-[abc]:/gm) ?? []).length;
  if (count !== 3) failures.push(`expected exactly 3 implementation workers; found ${count}`);
} catch (error) {
  failures.push(`cannot inspect worker ownership: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length) {
  console.error("FleetOS source-of-truth check FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("FleetOS source-of-truth check PASSED");
console.log("Canonical architecture, ownership, work catalog, TL handoff and continuation files are present.");
console.log("Exactly three implementation workers are registered.");
console.log(`Product identity: ${packageJson.name}`);
console.log(`Architecture lock: ${packageJson.fleetosArchitecture}`);