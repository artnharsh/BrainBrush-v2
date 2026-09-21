// ==========================================
// DEADLOCK DETECTION — Wait-For Graph (DFS)
// ==========================================
// Lab Assignment 3: Implement a deadlock detection mechanism
// using a Wait-For Graph to identify cycles among processes.
//
// CONCEPT:
// A deadlock occurs when a set of processes are each waiting
// for a resource held by another process in the set, forming
// a circular dependency (cycle in the wait-for graph).
//
// ALGORITHM:
// 1. Build a directed graph where an edge P1 → P2 means
//    "Process P1 is waiting for a resource held by P2"
// 2. Run DFS on the graph to detect cycles
// 3. If a cycle is found → DEADLOCK detected
//
// BRAINBRUSH TIE-IN:
// Imagine a scenario where:
//   - Room A needs a Redis lock held by Room B's timer
//   - Room B needs a Redis lock held by Room A's scorer
//   → Deadlock! Neither room can proceed.
//
// Run: npx ts-node labs/deadlock-detection/deadlock.ts
// ==========================================

interface WaitForGraph {
  adjacencyList: Map<string, string[]>;
}

class DeadlockDetector {
  private graph: WaitForGraph;

  constructor() {
    this.graph = { adjacencyList: new Map() };
  }

  /**
   * Add a "wait-for" edge: processA is waiting for processB
   */
  addWaitFor(processA: string, processB: string): void {
    if (!this.graph.adjacencyList.has(processA)) {
      this.graph.adjacencyList.set(processA, []);
    }
    this.graph.adjacencyList.get(processA)!.push(processB);
    
    // Ensure processB exists in the graph even if it has no outgoing edges
    if (!this.graph.adjacencyList.has(processB)) {
      this.graph.adjacencyList.set(processB, []);
    }

    console.log(`  📌 ${processA} → waits for → ${processB}`);
  }

  /**
   * Remove a "wait-for" edge (resource released)
   */
  removeWaitFor(processA: string, processB: string): void {
    const edges = this.graph.adjacencyList.get(processA);
    if (edges) {
      const index = edges.indexOf(processB);
      if (index !== -1) {
        edges.splice(index, 1);
        console.log(`  ✅ ${processA} no longer waits for ${processB}`);
      }
    }
  }

  /**
   * Detect deadlocks using DFS cycle detection.
   * Returns the cycle path if a deadlock is found, or null.
   */
  detectDeadlock(): string[] | null {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const parent = new Map<string, string>();

    for (const node of this.graph.adjacencyList.keys()) {
      if (!visited.has(node)) {
        const cycle = this.dfs(node, visited, recursionStack, parent);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  private dfs(
    node: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    parent: Map<string, string>
  ): string[] | null {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = this.graph.adjacencyList.get(node) || [];

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        parent.set(neighbor, node);
        const cycle = this.dfs(neighbor, visited, recursionStack, parent);
        if (cycle) return cycle;
      } else if (recursionStack.has(neighbor)) {
        // CYCLE FOUND — trace back to find the full cycle path
        const cyclePath: string[] = [neighbor];
        let current = node;
        while (current !== neighbor) {
          cyclePath.unshift(current);
          current = parent.get(current)!;
        }
        cyclePath.unshift(neighbor); // Complete the cycle
        return cyclePath;
      }
    }

    recursionStack.delete(node);
    return null;
  }

  /**
   * Print the current state of the Wait-For Graph
   */
  printGraph(): void {
    console.log("\n📊 Current Wait-For Graph:");
    for (const [process, waitingFor] of this.graph.adjacencyList) {
      if (waitingFor.length > 0) {
        console.log(`  ${process} → [${waitingFor.join(", ")}]`);
      }
    }
  }
}

// ==========================================
// SIMULATION: BrainBrush Resource Contention
// ==========================================
console.log("═══════════════════════════════════════════════");
console.log("  DEADLOCK DETECTION — Wait-For Graph (DFS)");
console.log("  Lab Assignment 3 — Distributed Systems");
console.log("═══════════════════════════════════════════════\n");

const detector = new DeadlockDetector();

// --- Scenario 1: No Deadlock ---
console.log("🔹 Scenario 1: Normal resource acquisition (no deadlock)\n");
console.log("  Setting up wait-for relationships:");
detector.addWaitFor("RoomA-Timer", "Redis-Lock-1");
detector.addWaitFor("RoomB-Scorer", "Redis-Lock-2");
detector.addWaitFor("RoomC-Canvas", "Redis-Lock-3");

detector.printGraph();

let cycle = detector.detectDeadlock();
console.log(cycle 
  ? `\n  🔴 DEADLOCK DETECTED: ${cycle.join(" → ")}` 
  : "\n  🟢 No deadlock detected ✅"
);

// --- Scenario 2: Deadlock! ---
console.log("\n\n🔹 Scenario 2: Circular dependency (DEADLOCK)\n");

const detector2 = new DeadlockDetector();
console.log("  Setting up circular wait-for relationships:");
detector2.addWaitFor("Process-A", "Process-B");  // A waits for B
detector2.addWaitFor("Process-B", "Process-C");  // B waits for C
detector2.addWaitFor("Process-C", "Process-A");  // C waits for A → CYCLE!

detector2.printGraph();

cycle = detector2.detectDeadlock();
console.log(cycle 
  ? `\n  🔴 DEADLOCK DETECTED: ${cycle.join(" → ")}` 
  : "\n  🟢 No deadlock detected"
);

// --- Scenario 3: Complex graph with partial deadlock ---
console.log("\n\n🔹 Scenario 3: Complex graph — BrainBrush multi-room contention\n");

const detector3 = new DeadlockDetector();
console.log("  Setting up relationships:");
detector3.addWaitFor("Room1-DrawSocket", "Redis-Canvas-Lock");
detector3.addWaitFor("Redis-Canvas-Lock", "Room2-EraseHandler");
detector3.addWaitFor("Room2-EraseHandler", "Room1-DrawSocket");  // CYCLE!
detector3.addWaitFor("Room3-Timer", "Redis-Timer-Lock");         // Independent, no cycle

detector3.printGraph();

cycle = detector3.detectDeadlock();
console.log(cycle 
  ? `\n  🔴 DEADLOCK DETECTED: ${cycle.join(" → ")}` 
  : "\n  🟢 No deadlock detected"
);

// --- Resolution ---
console.log("\n\n🔹 Scenario 4: Resolving the deadlock\n");
console.log("  Breaking the cycle by releasing Room2-EraseHandler's wait:");
detector3.removeWaitFor("Room2-EraseHandler", "Room1-DrawSocket");

detector3.printGraph();

cycle = detector3.detectDeadlock();
console.log(cycle 
  ? `\n  🔴 DEADLOCK DETECTED: ${cycle.join(" → ")}` 
  : "\n  🟢 Deadlock resolved! ✅"
);

console.log("\n═══════════════════════════════════════════════");
console.log("  Deadlock detection complete.");
console.log("═══════════════════════════════════════════════\n");
