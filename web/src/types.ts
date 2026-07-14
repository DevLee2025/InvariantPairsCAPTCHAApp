// Shared contracts for the GRIT invariant-pairs game.
// Schema v3 — a reproducible *game record* (not a flat pair list) whose puzzles
// carry MULTI-SELECT `selections` (v2 single-select files are auto-upgraded on
// load by lib/upgrade.ts). See SPEC.md.

// ----------------------------------------------------------------------------
// Domains & classes (PACS)
// ----------------------------------------------------------------------------
export type Domain = "photo" | "art_painting" | "cartoon" | "sketch";
export type ClassName =
  | "dog"
  | "elephant"
  | "giraffe"
  | "guitar"
  | "horse"
  | "house"
  | "person";

export const DOMAINS: Domain[] = ["photo", "art_painting", "cartoon", "sketch"];
export const CLASSES: ClassName[] = [
  "dog",
  "elephant",
  "giraffe",
  "guitar",
  "horse",
  "house",
  "person",
];

// Dataset split. The game draws ONLY from "train"; val/test are held out so they
// never appear in collected invariant pairs (SPEC §3, §5.1).
export type Split = "train" | "val" | "test";

// ----------------------------------------------------------------------------
// Manifest schema (SPEC §4)
// ----------------------------------------------------------------------------
export interface MixProbs {
  balanced: number[]; // length-7
  photoHeavy: number[]; // length-7
  cartoonHeavy: number[]; // length-7
}

export interface Img {
  id: string; // "<domain>/<class>/<stem>"
  domain: Domain;
  class: ClassName;
  split: Split; // only "train" is drawn from
  file: string; // "<domain>/<class>/<stem>.jpg"
  clipProbs: number[]; // length-7
  ermProbs: number[]; // length-7
  mix: MixProbs | null; // present only for photo & cartoon images
  url: string; // resolved at load time (lib/manifest.ts)
}

export interface Manifest {
  version: number;
  domains: Domain[];
  classes: ClassName[];
  cdnBase: string;
  images: Img[];
}

export type ManifestField = "clipProbs" | "ermProbs" | "mix";

// ----------------------------------------------------------------------------
// Domain pairing (SPEC §5.2)
// ----------------------------------------------------------------------------
export type DomainPair =
  | "photo↔art_painting"
  | "photo↔cartoon"
  | "photo↔sketch"
  | "art_painting↔cartoon"
  | "art_painting↔sketch"
  | "cartoon↔sketch"
  | "random" // anchor any; candidates from ANY non-anchor domain (mixed)
  | "random_single"; // anchor any; candidates from ONE random non-anchor domain (re-rolled per round)

export const DOMAIN_PAIRS: DomainPair[] = [
  "photo↔art_painting",
  "photo↔cartoon",
  "photo↔sketch",
  "art_painting↔cartoon",
  "art_painting↔sketch",
  "cartoon↔sketch",
  "random",
  "random_single",
];

// Human-friendly label for the pairing dropdown / strategy panel.
export function pairingLabel(p: DomainPair): string {
  if (p === "random") return "Random (mixed)";
  if (p === "random_single") return "Random (single domain)";
  return p;
}

// ----------------------------------------------------------------------------
// Seeded RNG (reproducibility). Same seed ⇒ same stream ⇒ same game.
// ----------------------------------------------------------------------------
export type RNG = () => number; // float in [0, 1)

// ----------------------------------------------------------------------------
// Mode registry (SPEC §5.3)
// ----------------------------------------------------------------------------
export type ModeId = "cross_domain" | "erm_clip" | "mixture";

export type Params = Record<string, number>;

// Context passed to a mode's blurb() so the strategy panel can describe the round.
export interface SelectCtx {
  anchor: Img | null;
  poolSize: number;
  optionCount: number; // gridSize²
  params: Params;
  domainPairing: DomainPair;
}

// Args passed to a mode's select(). The rng is the game's single seeded stream.
export interface SelectArgs {
  rng: RNG;
  count: number; // number of options to return (gridSize²)
  params: Params;
}

export interface SelectionResult {
  // Ordered options; index i ⇒ grid position i+1.
  candidates: Img[];
  // Per-candidate scores keyed by candidate id; mode-specific shape.
  scoresById: Record<string, Record<string, number>>;
}

export interface SelectionMode {
  id: ModeId;
  label: string;
  blurb: (ctx: SelectCtx) => string;
  requiredFields: ManifestField[];
  lockedPairing?: DomainPair;
  defaultParams?: Params;
  select(anchor: Img, pool: Img[], args: SelectArgs): SelectionResult;
}

// ----------------------------------------------------------------------------
// Session & quota (SPEC §6)
// ----------------------------------------------------------------------------
export interface SessionConfig {
  perModeQuota: Record<ModeId, number>;
  order: ModeId[];
}

export type PresetName = "dev" | "production";

// ----------------------------------------------------------------------------
// Grid size (req 6) — square grids, default 3×3.
// ----------------------------------------------------------------------------
export const GRID_SIZES = [2, 3, 4, 5, 6, 7, 8] as const;
export type GridSize = (typeof GRID_SIZES)[number];

// Selection algorithm version. Bump when the draw logic changes so old seeds are
// not silently "reproduced" by a different algorithm.
export const ALGO_VERSION = 1;

// ----------------------------------------------------------------------------
// PACS Analyzer: 42 triplets = 7 classes × 6 unordered domain pairs. A human
// inspects clusters of cross-domain pairs per triplet and judges alikeness.
// ----------------------------------------------------------------------------
export type AnalyzerMode = "random" | "erm";

// How ERM mode ranks candidate pairs (dropdown; "confident" is the default).
export type ErmCriterion = "confident" | "divergence" | "agreement";

export const ERM_CRITERIA: { id: ErmCriterion; label: string }[] = [
  { id: "confident", label: "Confident exemplars" },
  { id: "divergence", label: "ERM divergence" },
  { id: "agreement", label: "ERM agreement" },
];

// The 6 unordered domain pairs in canonical order. Must match the pipeline's
// itertools.combinations(DOMAINS, 2) order (build_triplet_stats.py).
export const UNORDERED_PAIRS: [Domain, Domain][] = [
  ["photo", "art_painting"],
  ["photo", "cartoon"],
  ["photo", "sketch"],
  ["art_painting", "cartoon"],
  ["art_painting", "sketch"],
  ["cartoon", "sketch"],
];

export interface Triplet {
  class: ClassName;
  domainA: Domain;
  domainB: Domain;
}

export function tripletKey(t: Triplet): string {
  return `${t.class}|${t.domainA}|${t.domainB}`;
}

// Shape of web/public/triplet_stats.json (pipeline/build_triplet_stats.py).
export interface TripletStat {
  class: ClassName;
  domainA: Domain;
  domainB: Domain;
  nA: number;
  nB: number;
  meanCos: number;
  medianCos: number;
  p10: number;
  p90: number;
}

export interface TripletStatsFile {
  version: number;
  split: Split;
  clipModel: string;
  generatedAt: string;
  triplets: TripletStat[];
}

// A recorded human judgment of one triplet's cluster, with full provenance so
// the exact inspected cluster can be regenerated (same ethos as GameRecord).
export interface AnalyzerJudgment {
  key: string; // tripletKey
  class: ClassName;
  domainA: Domain;
  domainB: Domain;
  rating: 1 | 2 | 3 | 4 | 5; // 1 = least alike … 5 = most alike
  note: string;
  mode: AnalyzerMode;
  criterion: ErmCriterion | null; // null in random mode
  seed: number;
  clusterSize: number;
  at: string; // ISO
}

export interface AnalyzerExportRecord {
  schemaVersion: "analyzer-1";
  manifest: ManifestInfo;
  split: Split;
  judgments: AnalyzerJudgment[];
  exportedAt: string;
}

// ----------------------------------------------------------------------------
// Game record (schema v2)
// ----------------------------------------------------------------------------
export interface ImgRef {
  id: string;
  domain: Domain;
  class: ClassName;
  split: Split;
  url: string;
}

export interface PuzzleOption extends ImgRef {
  position: number; // 1..N²
}

// One selected option (schema v3 multi-select), in pick order.
export interface SelectedOption extends PuzzleOption {
  pickedAt: string; // ISO — when the player (last) toggled it on
}

export interface PuzzleRecord {
  puzzleIndex: number; // 1-based, in play order (req 2)
  mode: ModeId; // mode active for this puzzle (games may switch modes)
  domainPairing: DomainPair; // effective pairing for this puzzle (replay-robust)
  anchor: ImgRef;
  options: PuzzleOption[]; // ordered by position (req 3)
  // v3 canonical: EVERY selected option, ordered by pick order. Each selection
  // is one invariant pair (anchor, selection). Empty ⇒ "no good options".
  selections: SelectedOption[];
  // Mode scores per selected id (Modes 2/3; empty for cross_domain — omitted
  // from exported JSON when empty for Parquet safety).
  selectionScores: Record<string, Record<string, number>>;
  // Legacy v2 mirrors of the FIRST pick, kept populated so v2-era tooling can
  // still read v3 files (it sees the primary pick only).
  selectedPosition: number; // first pick's position, or 0 when none
  selected: ImgRef | null; // first pick, or null when none
  noGood: boolean; // player rejected all options (no invariant pair produced)
  shownAt: string; // ISO — when the puzzle was rendered (req 7)
  selectedAt: string; // ISO — when the player submitted (last pick for v2 files)
  durationMs: number; // selectedAt − shownAt
  reviewFlag: boolean; // player flagged for review (req 5a)
  playerNote: string; // player's plain-text note (req 5a)
  screenshotIndex: number | null; // → screenshots PDF (req 5b; Phase B)
  scores: Record<string, number>; // legacy mirror: first pick's mode scores
}

export interface GameTiming {
  overallMs: number | null; // page-load → first export (req 7)
  averageMs: number | null;
  medianMs: number | null;
  perCaptchaMs: number[];
}

export interface ManifestInfo {
  version: number;
  imageCount: number;
  hash: string; // content fingerprint to pin the dataset for replay
}

export interface ReviewerAnnotation {
  puzzleIndex: number;
  comment: string;
  at: string; // ISO
  annotator?: string; // multi-annotator mode: who wrote it
  // Shared (blind) mode: when this annotator revealed the puzzle's responses.
  // null ⇒ the comment was written fully blind; absent ⇒ local single-user mode.
  revealedAt?: string | null;
}

export interface GameMeta {
  gameId: string;
  sessionId: string;
  seed: number; // master PRNG seed — regenerates the game (req 2)
  algoVersion: number;
  mode: ModeId;
  domainPairing: DomainPair;
  gridSize: number;
  optionCount: number; // gridSize²
  split: Split; // which split was drawn (req 1)
  manifest: ManifestInfo;
  startedAt: string; // ISO — page load / game start
  endedAt: string | null; // ISO — first export
  timing: GameTiming;
}

export interface GameRecord {
  schemaVersion: 3; // in-memory records are ALWAYS v3 (v2 files upgraded on load)
  game: GameMeta;
  puzzles: PuzzleRecord[];
  reviewerAnnotations: ReviewerAnnotation[]; // added in Review mode (Phase C)
}
