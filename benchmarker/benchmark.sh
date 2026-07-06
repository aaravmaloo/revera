#!/usr/bin/env bash
# =============================================================================
# benchmark.sh — Revera large-scale benchmark runner
#
# Usage:
#   ./benchmark.sh [options]
#
# Options:
#   --workers N        Number of parallel workers (default: nproc)
#   --dataset PATH     Path to JSONL dataset   (default: datasets/npm.jsonl)
#   --output-dir DIR   Where to save results   (default: ~/revera_benchmarks)
#   --threshold N      Score threshold 0-100   (default: 60)
#   --branch NAME      Git branch to test      (default: main)
#   --resume RUN_ID    Resume a specific run ID
#   --repo URL         Repo to clone           (default: REVERA_REPO env or upstream)
#
# Environment:
#   REVERA_REPO    Override the repository URL
#   REVERA_BRANCH  Override the branch name
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults ──────────────────────────────────────────────────────────────────
# ── Defaults ──────────────────────────────────────────────────────────────────
if [[ -d "$SCRIPT_DIR/../.git" ]]; then
  DEFAULT_REPO="$SCRIPT_DIR/.."
else
  DEFAULT_REPO="https://github.com/aaravmaloo/revera.git"
fi
REPO_URL="${REVERA_REPO:-$DEFAULT_REPO}"
BRANCH="${REVERA_BRANCH:-master}"
WORKERS="${WORKERS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
DATASET="${DATASET:-$SCRIPT_DIR/datasets/npm.jsonl}"
OUTPUT_DIR="${OUTPUT_DIR:-$HOME/revera_benchmarks}"
THRESHOLD=60
RESUME_ID=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workers)    WORKERS="$2";    shift 2 ;;
    --dataset)    DATASET="$2";    shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --threshold)  THRESHOLD="$2";  shift 2 ;;
    --branch)     BRANCH="$2";     shift 2 ;;
    --repo)       REPO_URL="$2";   shift 2 ;;
    --resume)     RESUME_ID="$2";  shift 2 ;;
    -h|--help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# ── Colour helpers ────────────────────────────────────────────────────────────
BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'

info()  { echo "${CYAN}▶${RESET}  $*"; }
ok()    { echo "${GREEN}✓${RESET}  $*"; }
warn()  { echo "${YELLOW}⚠${RESET}  $*"; }
die()   { echo "${RED}✖${RESET}  $*" >&2; exit 1; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo ""
echo "${BOLD}  Revera Benchmark Runner${RESET}"
echo "${DIM}  ──────────────────────────────────────────────${RESET}"
echo ""

command -v git   >/dev/null 2>&1 || die "git not found"
command -v pnpm  >/dev/null 2>&1 || die "pnpm not found (install: npm i -g pnpm)"
command -v node  >/dev/null 2>&1 || die "node not found"
command -v npm   >/dev/null 2>&1 || die "npm not found"

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  die "Node.js >=22 required (found $(node --version))"
fi

# ── Check dataset ─────────────────────────────────────────────────────────────
if [[ ! -f "$DATASET" ]]; then
  warn "Dataset not found: $DATASET"
  info "Fetching dataset now..."
  (cd "$SCRIPT_DIR" && npm run fetch-dataset) || die "Dataset fetch failed. Run manually: cd benchmarker && npm run fetch-dataset"
fi

DATASET_LINES=$(wc -l < "$DATASET" | tr -d ' ')
info "Dataset: ${BOLD}$DATASET${RESET}  (${DATASET_LINES} packages)"

# ── Clone revera into a temp dir ──────────────────────────────────────────────
BUILD_DIR="$(mktemp -d /tmp/revera-build-XXXXXX)"
info "Cloning ${BOLD}${REPO_URL}${RESET} @ ${BRANCH} → $BUILD_DIR"

cleanup() {
  echo ""
  info "Cleaning up temp build dir: $BUILD_DIR"
  rm -rf "$BUILD_DIR"
}
# Always clean up, even on error or CTRL-C
trap cleanup EXIT INT TERM

# Check if BRANCH is a commit SHA (7-40 hex chars)
if [[ "$BRANCH" =~ ^[0-9a-f]{7,40}$ ]]; then
  info "Branch parameter is a commit SHA. Doing full clone and checking out SHA..."
  if ! git clone --quiet "$REPO_URL" "$BUILD_DIR"; then
    die "git clone failed"
  fi
  (cd "$BUILD_DIR" && git checkout --quiet "$BRANCH") || die "git checkout $BRANCH failed"
else
  # Try shallow clone first, if it fails, try a full clone
  if ! git clone --depth=1 --branch "$BRANCH" --quiet "$REPO_URL" "$BUILD_DIR" 2>/dev/null; then
    warn "Shallow clone failed. Trying full clone..."
    if ! git clone --branch "$BRANCH" --quiet "$REPO_URL" "$BUILD_DIR"; then
      echo ""
      echo "${RED}✖  Git clone failed completely.${RESET}"
      echo "If your server has network/firewall issues connecting to GitHub via HTTPS:"
      echo "  1. Try using SSH URL: ./benchmark.sh --repo git@github.com:aaravmaloo/revera.git"
      echo "  2. Or sync the entire revera folder (including .git) to the server and the script will automatically use it locally."
      exit 1
    fi
  fi
fi

ok "Cloned ($(git -C "$BUILD_DIR" rev-parse --short HEAD))"

# ── Build revera ──────────────────────────────────────────────────────────────
info "Installing revera dependencies..."
(cd "$BUILD_DIR" && pnpm install --frozen-lockfile ) || die "pnpm install failed"

info "Building revera (pnpm build)..."
(cd "$BUILD_DIR" && pnpm build) || die "pnpm build failed"

REVERA_DIST="$BUILD_DIR/dist"
REVERA_VERSION=$(node -e "const p=require('$BUILD_DIR/package.json'); process.stdout.write(p.version)" 2>/dev/null || echo "unknown")
ok "Built revera v${REVERA_VERSION} → $REVERA_DIST"

# ── Set up benchmarker ────────────────────────────────────────────────────────
info "Compiling benchmarker TypeScript..."
(cd "$SCRIPT_DIR" && npm run build) || die "TypeScript compilation failed"

# ── Run benchmarks ────────────────────────────────────────────────────────────
echo ""
echo "${DIM}  ──────────────────────────────────────────────${RESET}"
info "Starting benchmark"
echo "${DIM}  Workers   : $WORKERS${RESET}"
echo "${DIM}  Threshold : $THRESHOLD${RESET}"
echo "${DIM}  Output    : $OUTPUT_DIR${RESET}"
echo "${DIM}  ──────────────────────────────────────────────${RESET}"
echo ""

RESUME_FLAG=""
if [[ -n "$RESUME_ID" ]]; then
  RESUME_FLAG="--resume $RESUME_ID"
fi

node "$SCRIPT_DIR/dist/runner.js" --revera-dist "$REVERA_DIST" --dataset "$DATASET" --workers "$WORKERS" --output-dir "$OUTPUT_DIR" --threshold "$THRESHOLD" $RESUME_FLAG

# Cleanup happens via trap EXIT
