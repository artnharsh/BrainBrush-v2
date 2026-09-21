// ==========================================
// HADOOP WORD COUNT — MapReduce Simulation
// ==========================================
// Lab Assignment 5: Implement a MapReduce program to count
// word frequencies from text data.
//
// Since installing a full Hadoop cluster is out of scope for
// BrainBrush, we simulate the MapReduce paradigm in Node.js
// using the same conceptual phases:
//
//   1. INPUT:    Read BrainBrush chat log data
//   2. MAP:      Split each line into (word, 1) pairs
//   3. SHUFFLE:  Group all pairs by key (word)
//   4. REDUCE:   Sum counts for each word
//   5. OUTPUT:   Sorted word frequency table
//
// This demonstrates the MapReduce programming model used by
// Apache Hadoop for distributed data processing at scale.
//
// Run: npx ts-node labs/hadoop-wordcount/wordcount.ts
// ==========================================

// ==========================================
// SIMULATED BRAINBRUSH CHAT LOGS
// (In a real Hadoop setup, this would be stored in HDFS)
// ==========================================
const chatLogs: string[] = [
  "is it a cat",
  "no its not a cat",
  "maybe its a dog",
  "is it a house",
  "its definitely a house",
  "the drawing looks like a car",
  "no thats not a car its a bus",
  "is it an animal",
  "yes its an animal a dog",
  "nice drawing keep going",
  "what is that supposed to be",
  "looks like a tree to me",
  "no its a flower not a tree",
  "is it a guitar",
  "yes its a guitar well done",
  "almost got it its a piano",
  "great drawing everyone guessed it",
  "that was easy lets do another round",
  "this one is harder",
  "is it a mountain or a volcano",
  "its a volcano nice guess",
  "the game is really fun",
  "brainbrush is the best drawing game",
  "can we play another round",
  "lets keep playing this is awesome",
];

// ==========================================
// PHASE 1: MAP
// ==========================================
// The Mapper takes each line of input and emits (key, value)
// pairs where key = word and value = 1.
//
// In Hadoop, this runs in parallel across multiple nodes.
// Each node processes a SPLIT (chunk) of the input data.
// ==========================================
interface MapOutput {
  word: string;
  count: number;
}

function mapPhase(inputLines: string[]): MapOutput[] {
  console.log("📗 MAP PHASE — Splitting lines into (word, 1) pairs\n");

  const mapped: MapOutput[] = [];

  for (const line of inputLines) {
    // Normalize: lowercase, remove punctuation
    const words = line
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 0);

    for (const word of words) {
      mapped.push({ word, count: 1 });
    }
  }

  console.log(`  Emitted ${mapped.length} (word, 1) pairs from ${inputLines.length} lines`);

  // Show first 10 pairs as example
  console.log("  Sample pairs:");
  mapped.slice(0, 10).forEach((pair) => {
    console.log(`    ("${pair.word}", ${pair.count})`);
  });
  console.log("    ...\n");

  return mapped;
}

// ==========================================
// PHASE 2: SHUFFLE & SORT
// ==========================================
// The Shuffle phase groups all (key, value) pairs by key.
// In Hadoop, this is done by the framework automatically
// between the Map and Reduce phases. It involves:
//   - Partitioning (which reducer gets which keys)
//   - Sorting (keys are sorted within each partition)
//   - Transferring data across the network to reducers
// ==========================================
function shufflePhase(mapped: MapOutput[]): Map<string, number[]> {
  console.log("📙 SHUFFLE PHASE — Grouping pairs by key\n");

  const grouped = new Map<string, number[]>();

  for (const pair of mapped) {
    if (!grouped.has(pair.word)) {
      grouped.set(pair.word, []);
    }
    grouped.get(pair.word)!.push(pair.count);
  }

  console.log(`  Grouped into ${grouped.size} unique keys`);

  // Show a few examples
  console.log("  Sample groups:");
  let count = 0;
  for (const [word, counts] of grouped) {
    if (count >= 5) break;
    console.log(`    "${word}" → [${counts.join(", ")}]`);
    count++;
  }
  console.log("    ...\n");

  return grouped;
}

// ==========================================
// PHASE 3: REDUCE
// ==========================================
// The Reducer takes each (key, list_of_values) group and
// produces a single output (key, aggregated_value).
// For word count, we simply SUM all the 1s.
//
// In Hadoop, multiple reducers run in parallel, each
// handling a subset of the keys.
// ==========================================
function reducePhase(grouped: Map<string, number[]>): Map<string, number> {
  console.log("📕 REDUCE PHASE — Summing counts per word\n");

  const result = new Map<string, number>();

  for (const [word, counts] of grouped) {
    const totalCount = counts.reduce((sum, c) => sum + c, 0);
    result.set(word, totalCount);
  }

  console.log(`  Reduced to ${result.size} final word counts\n`);
  return result;
}

// ==========================================
// PHASE 4: OUTPUT
// ==========================================
function outputPhase(wordCounts: Map<string, number>): void {
  console.log("📊 OUTPUT — Final Word Frequency Table\n");

  // Sort by count (descending)
  const sorted = [...wordCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Table header
  console.log("  ┌──────────────────┬───────┐");
  console.log("  │      Word        │ Count │");
  console.log("  ├──────────────────┼───────┤");

  for (const [word, count] of sorted.slice(0, 20)) {
    const paddedWord = word.padEnd(16);
    const paddedCount = count.toString().padStart(5);
    console.log(`  │ ${paddedWord} │${paddedCount} │`);
  }

  console.log("  └──────────────────┴───────┘");

  if (sorted.length > 20) {
    console.log(`  ... and ${sorted.length - 20} more words`);
  }

  // Summary statistics
  const totalWords = [...wordCounts.values()].reduce((s, c) => s + c, 0);
  const uniqueWords = wordCounts.size;
  console.log(`\n  📈 Total words processed: ${totalWords}`);
  console.log(`  📈 Unique words found: ${uniqueWords}`);
  console.log(`  📈 Most frequent word: "${sorted[0][0]}" (${sorted[0][1]} occurrences)`);
}

// ==========================================
// MAIN — Run the MapReduce Pipeline
// ==========================================
console.log("═══════════════════════════════════════════════");
console.log("  HADOOP WORD COUNT — MapReduce Simulation");
console.log("  Lab Assignment 5 — Distributed Systems");
console.log("  Input: BrainBrush Chat Logs");
console.log("═══════════════════════════════════════════════\n");
console.log(`📥 INPUT: ${chatLogs.length} chat messages from BrainBrush game\n`);

// Run the MapReduce pipeline
const mapped = mapPhase(chatLogs);
const shuffled = shufflePhase(mapped);
const reduced = reducePhase(shuffled);
outputPhase(reduced);

console.log("\n═══════════════════════════════════════════════");
console.log("  MapReduce pipeline complete.");
console.log("  In Hadoop, each phase would run on separate");
console.log("  nodes in a distributed cluster via HDFS.");
console.log("═══════════════════════════════════════════════\n");
