/**
 * @fleetos/mission — mission definitions.
 *
 * A mission definition is an ordered list of stages with optional
 * parallel groups and per-stage guards (capability / predicate refs).
 * Validation is a pure function with machine-stable rejection codes:
 * cycle-free (the combined execution graph — explicit dependencies plus
 * the declared block sequence — must be a DAG), guard refs present,
 * dependencies known, no intra-group dependencies (a parallel group that
 * depends on itself is a contradiction).
 *
 * Execution blocks: a contiguous run of stages sharing the same
 * `parallelGroup` forms ONE parallel block whose members are issued
 * together; every other stage is a singleton block. Block k becomes
 * ready when block k-1 is fully completed.
 */

import { fail, ok, type Result } from "./result.js";
import { isValidStageId } from "./ids.js";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type GuardKind = "capability" | "predicate";

export interface GuardRef {
  readonly kind: GuardKind;
  readonly ref: string;
}

export interface StageDefinition {
  readonly id: string;
  readonly guards?: ReadonlyArray<GuardRef>;
  /** Stage ids that must complete before this stage. */
  readonly dependsOn?: ReadonlyArray<string>;
  /** Stages sharing a non-null group form one parallel block. */
  readonly parallelGroup?: string | null;
}

export interface MissionDefinition {
  readonly id: string;
  readonly stages: ReadonlyArray<StageDefinition>;
}

export interface StageBlock {
  /** The member stages, in declared order. */
  readonly stages: ReadonlyArray<StageDefinition>;
  readonly parallel: boolean;
  readonly groupId: string | null;
}

export interface ValidatedMissionDefinition {
  readonly definition: MissionDefinition;
  readonly blocks: ReadonlyArray<StageBlock>;
  readonly stageBlockIndex: ReadonlyMap<string, number>;
}

export type DefinitionRejection =
  | "missing-definition-id"
  | "no-stages"
  | "invalid-stage-id"
  | "duplicate-stage-id"
  | "invalid-guard"
  | "unknown-guard"
  | "unknown-dependency"
  | "self-dependency"
  | "parallel-group-dependency"
  | "cycle-detected";

export function guardKey(guard: GuardRef): string {
  return `${guard.kind}:${guard.ref}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateMissionDefinition(input: {
  readonly definition: MissionDefinition;
  /** Optional registry of known guard keys (`capability:ref` / `predicate:ref`). */
  readonly knownGuards?: ReadonlySet<string>;
}): Result<ValidatedMissionDefinition, DefinitionRejection> {
  const { definition } = input;
  if (typeof definition.id !== "string" || definition.id === "") {
    return fail("missing-definition-id");
  }
  if (!Array.isArray(definition.stages) || definition.stages.length < 1) {
    return fail("no-stages");
  }

  const seen = new Set<string>();
  for (const stage of definition.stages) {
    if (typeof stage.id !== "string" || !isValidStageId(stage.id)) {
      return fail("invalid-stage-id");
    }
    if (seen.has(stage.id)) return fail("duplicate-stage-id");
    seen.add(stage.id);
    for (const guard of stage.guards ?? []) {
      if (
        guard === null ||
        typeof guard !== "object" ||
        (guard.kind !== "capability" && guard.kind !== "predicate") ||
        typeof guard.ref !== "string" ||
        guard.ref === ""
      ) {
        return fail("invalid-guard");
      }
      if (input.knownGuards && !input.knownGuards.has(guardKey(guard))) {
        return fail("unknown-guard");
      }
    }
    for (const dep of stage.dependsOn ?? []) {
      if (typeof dep !== "string" || dep === "") {
        return fail("unknown-dependency");
      }
      if (dep === stage.id) return fail("self-dependency");
    }
  }

  // Intra-group dependencies: a parallel group member depending on another
  // member contradicts the parallel semantics.
  const groupOf = new Map<string, string | null>();
  for (const stage of definition.stages) {
    const group = stage.parallelGroup ?? null;
    groupOf.set(stage.id, group === "" ? null : group);
  }
  for (const stage of definition.stages) {
    for (const dep of stage.dependsOn ?? []) {
      if (groupOf.get(stage.id) !== null && groupOf.get(stage.id) === groupOf.get(dep)) {
        return fail("parallel-group-dependency");
      }
    }
  }

  const blocks = computeBlocks(definition.stages);
  const stageBlockIndex = new Map<string, number>();
  blocks.forEach((block, index) => {
    for (const stage of block.stages) stageBlockIndex.set(stage.id, index);
  });

  // Unknown dependencies (checked after id validation so the message is stable).
  for (const stage of definition.stages) {
    for (const dep of stage.dependsOn ?? []) {
      if (!stageBlockIndex.has(dep)) return fail("unknown-dependency");
    }
  }

  // Cycle detection over the COMBINED execution graph: explicit dependency
  // edges + block-sequence edges (every stage of block k-1 precedes every
  // stage of block k). A dependency pointing forward contradicts the
  // declared sequence and closes a cycle — rejected here.
  const successors = new Map<string, string[]>();
  for (const stage of definition.stages) successors.set(stage.id, []);
  blocks.forEach((block, index) => {
    if (index === 0) return;
    const prev = blocks[index - 1];
    if (!prev) return;
    for (const target of block.stages) {
      for (const before of prev.stages) {
        successors.get(before.id)?.push(target.id);
      }
    }
  });
  for (const stage of definition.stages) {
    for (const dep of stage.dependsOn ?? []) {
      successors.get(dep)?.push(stage.id);
    }
  }
  // Iterative DFS with a tri-color marking.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const stage of definition.stages) color.set(stage.id, WHITE);
  for (const start of definition.stages) {
    if (color.get(start.id) !== WHITE) continue;
    const stack: Array<{ node: string; nextIndex: number }> = [
      { node: start.id, nextIndex: 0 },
    ];
    color.set(start.id, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const edges = successors.get(top.node) ?? [];
      if (top.nextIndex < edges.length) {
        const next = edges[top.nextIndex];
        top.nextIndex += 1;
        if (next === undefined) continue;
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) return fail("cycle-detected");
        if (nextColor === WHITE) {
          color.set(next, GRAY);
          stack.push({ node: next, nextIndex: 0 });
        }
      } else {
        color.set(top.node, BLACK);
        stack.pop();
      }
    }
  }

  return ok({ definition, blocks, stageBlockIndex });
}

// ---------------------------------------------------------------------------
// Readiness — pure helpers over the validated definition.
// ---------------------------------------------------------------------------

/**
 * A stage is READY when it has not started, every explicit dependency is
 * completed, and the previous block is fully completed.
 */
export function isStageReady(input: {
  readonly validated: ValidatedMissionDefinition;
  readonly stageId: string;
  readonly completedStages: ReadonlySet<string>;
  readonly startedStages: ReadonlySet<string>;
}): boolean {
  const { validated, stageId, completedStages, startedStages } = input;
  if (startedStages.has(stageId)) return false;
  const stage = validated.definition.stages.find((s) => s.id === stageId);
  if (!stage) return false;
  for (const dep of stage.dependsOn ?? []) {
    if (!completedStages.has(dep)) return false;
  }
  const blockIndex = validated.stageBlockIndex.get(stageId);
  if (blockIndex === undefined || blockIndex === 0) return true;
  const prevBlock = validated.blocks[blockIndex - 1];
  if (!prevBlock) return true;
  for (const member of prevBlock.stages) {
    if (!completedStages.has(member.id)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function computeBlocks(
  stages: ReadonlyArray<StageDefinition>,
): StageBlock[] {
  const blocks: StageBlock[] = [];
  let i = 0;
  while (i < stages.length) {
    const stage = stages[i];
    if (!stage) break;
    const group = stage.parallelGroup ?? null;
    const normalizedGroup = group === "" ? null : group;
    if (normalizedGroup === null) {
      blocks.push({ stages: [stage], parallel: false, groupId: null });
      i += 1;
    } else {
      let j = i;
      while (j < stages.length) {
        const candidate = stages[j];
        if (!candidate) break;
        const candidateGroup = candidate.parallelGroup ?? null;
        if (candidateGroup !== normalizedGroup) break;
        j += 1;
      }
      blocks.push({
        stages: stages.slice(i, j),
        parallel: true,
        groupId: normalizedGroup,
      });
      i = j;
    }
  }
  return blocks;
}
