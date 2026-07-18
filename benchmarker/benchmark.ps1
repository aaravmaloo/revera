<#
.SYNOPSIS
    Revera large-scale benchmark runner (PowerShell port of benchmark.sh)

.DESCRIPTION
    Clones revera, builds it, and runs the benchmarker against a dataset.

.PARAMETER Workers
    Number of parallel workers (default: number of logical processors)

.PARAMETER Dataset
    Path to JSONL dataset (default: <script dir>/datasets/npm.jsonl)

.PARAMETER OutputDir
    Where to save results (default: $HOME/revera_benchmarks)

.PARAMETER Threshold
    Score threshold 0-100 (default: 60)

.PARAMETER Branch
    Git branch or commit SHA to test (default: master)

.PARAMETER Resume
    Resume a specific run ID

.PARAMETER Repo
    Repo to clone (default: REVERA_REPO env var, or local .. if it's a git repo, else upstream)

.EXAMPLE
    ./benchmark.ps1 --workers 8
    ./benchmark.ps1 -Workers 8
#>

[CmdletBinding()]
param(
    [int]$Workers = 0,
    [string]$Dataset = "",
    [string]$OutputDir = "",
    [int]$Threshold = 60,
    [string]$Branch = "",
    [string]$Resume = "",
    [string]$Repo = ""
)

# PowerShell param binding is already case-insensitive, so "-workers" matches
# "-Workers" with no [Alias] needed — an alias with the same name (different
# case only) actually conflicts and throws, which was the previous bug.
# Note: use single-dash params, e.g. -Workers 8, not --workers 8.
if ($args.Count -gt 0) {
    Write-Host "Note: use single-dash PowerShell params, e.g. -Workers 8 instead of --workers 8" -ForegroundColor DarkYellow
}

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Defaults ──────────────────────────────────────────────────────────────────
if (Test-Path (Join-Path $SCRIPT_DIR "..\.git")) {
    $DEFAULT_REPO = Resolve-Path (Join-Path $SCRIPT_DIR "..")
} else {
    $DEFAULT_REPO = "https://github.com/aaravmaloo/revera.git"
}

if (-not $Repo)      { $Repo      = if ($env:REVERA_REPO)   { $env:REVERA_REPO }   else { $DEFAULT_REPO } }
if (-not $Branch)    { $Branch    = if ($env:REVERA_BRANCH) { $env:REVERA_BRANCH } else { "master" } }
if ($Workers -eq 0)  { $Workers   = if ($env:WORKERS)        { [int]$env:WORKERS }  else { [Environment]::ProcessorCount } }
if (-not $Dataset)   { $Dataset   = if ($env:DATASET)        { $env:DATASET }       else { Join-Path $SCRIPT_DIR "datasets\npm.jsonl" } }
if (-not $OutputDir) { $OutputDir = if ($env:OUTPUT_DIR)     { $env:OUTPUT_DIR }    else { Join-Path $HOME "revera_benchmarks" } }

$REPO_URL  = $Repo
$RESUME_ID = $Resume

# ── Colour helpers ────────────────────────────────────────────────────────────
$BOLD   = ""
$DIM    = ""
$RESET  = ""
$GREEN  = "Green"
$YELLOW = "DarkYellow"
$RED    = "Red"
$CYAN   = "Cyan"

function Info { param([string]$msg) Write-Host "▶  $msg" -ForegroundColor $CYAN }
function Ok   { param([string]$msg) Write-Host "✓  $msg" -ForegroundColor $GREEN }
function Warn { param([string]$msg) Write-Host "⚠  $msg" -ForegroundColor $YELLOW }
function Die  { param([string]$msg) Write-Host "✖  $msg" -ForegroundColor $RED; Cleanup; exit 1 }

function Cleanup {
    if ($script:BUILD_DIR -and (Test-Path $script:BUILD_DIR)) {
        Write-Host ""
        Info "Cleaning up temp build dir: $script:BUILD_DIR"
        Remove-Item -Recurse -Force $script:BUILD_DIR -ErrorAction SilentlyContinue
    }
}

# Run cleanup on any exit path (Ctrl+C, error, or normal completion)
try {

# ── Pre-flight checks ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Revera Benchmark Runner" -ForegroundColor White
Write-Host "  ──────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

function Require-Cmd {
    param([string]$name, [string]$hint = "")
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Die "$name not found$(if ($hint) { " ($hint)" })"
    }
}

Require-Cmd git
Require-Cmd pnpm "install: npm i -g pnpm"
Require-Cmd node
Require-Cmd npm

$NODE_MAJOR = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($NODE_MAJOR -lt 22) {
    Die "Node.js >=22 required (found $(node --version))"
}

# ── GitHub token check ────────────────────────────────────────────────────────
if (-not $env:GITHUB_TOKEN) {
    Warn "GITHUB_TOKEN is not set."
    Warn "Without it the GitHub API is limited to 60 requests/hour (unauthenticated)."
    Warn "On a 17k-package run this will cause thousands of vuln-check timeouts."
    Warn "Set BENCHMARK_GITHUB_TOKEN in repo Secrets and it will be injected automatically."
} else {
    Ok "GITHUB_TOKEN is set — GitHub API rate limit: 5,000 req/hr (authenticated)"
}

# ── Check dataset ─────────────────────────────────────────────────────────────
if (-not (Test-Path $Dataset)) {
    Warn "Dataset not found: $Dataset"
    Info "Fetching dataset now..."
    Push-Location $SCRIPT_DIR
    try {
        npm run fetch-dataset
        if ($LASTEXITCODE -ne 0) { Die "Dataset fetch failed. Run manually: cd benchmarker; npm run fetch-dataset" }
    } finally {
        Pop-Location
    }
}

$DATASET_LINES = (Get-Content $Dataset | Measure-Object -Line).Lines
Info "Dataset: $Dataset  ($DATASET_LINES packages)"

# ── Clone revera into a temp dir ──────────────────────────────────────────────
$BUILD_DIR = Join-Path ([System.IO.Path]::GetTempPath()) ("revera-build-" + [System.IO.Path]::GetRandomFileName().Substring(0,8))
New-Item -ItemType Directory -Path $BUILD_DIR | Out-Null
$script:BUILD_DIR = $BUILD_DIR

Info "Cloning $REPO_URL @ $Branch -> $BUILD_DIR"

# Check if Branch is a commit SHA (7-40 hex chars)
if ($Branch -match '^[0-9a-f]{7,40}$') {
    Info "Branch parameter is a commit SHA. Doing full clone and checking out SHA..."
    git clone --quiet $REPO_URL $BUILD_DIR
    if ($LASTEXITCODE -ne 0) { Die "git clone failed" }
    Push-Location $BUILD_DIR
    try {
        git checkout --quiet $Branch
        if ($LASTEXITCODE -ne 0) { Die "git checkout $Branch failed" }
    } finally {
        Pop-Location
    }
} else {
    $cloneOk = $false
    git clone --depth=1 --branch $Branch --quiet $REPO_URL $BUILD_DIR 2>$null
    if ($LASTEXITCODE -eq 0) {
        $cloneOk = $true
    } else {
        Warn "Shallow clone failed. Trying full clone..."
        git clone --branch $Branch --quiet $REPO_URL $BUILD_DIR
        if ($LASTEXITCODE -eq 0) {
            $cloneOk = $true
        }
    }
    if (-not $cloneOk) {
        Write-Host ""
        Write-Host "✖  Git clone failed completely." -ForegroundColor $RED
        Write-Host "If your server has network/firewall issues connecting to GitHub via HTTPS:"
        Write-Host "  1. Try using SSH URL: .\benchmark.ps1 -Repo git@github.com:aaravmaloo/revera.git"
        Write-Host "  2. Or sync the entire revera folder (including .git) to the server and the script will automatically use it locally."
        exit 1
    }
}

$shortHash = (git -C $BUILD_DIR rev-parse --short HEAD)
Ok "Cloned ($shortHash)"

# ── Build revera ──────────────────────────────────────────────────────────────
Info "Installing revera dependencies..."
Push-Location $BUILD_DIR
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }
} finally {
    Pop-Location
}

Info "Building revera (pnpm build)..."
Push-Location $BUILD_DIR
try {
    pnpm build
    if ($LASTEXITCODE -ne 0) { Die "pnpm build failed" }
} finally {
    Pop-Location
}

$REVERA_DIST = Join-Path $BUILD_DIR "dist"
$packageJsonPath = Join-Path $BUILD_DIR "package.json"
try {
    $REVERA_VERSION = (Get-Content $packageJsonPath -Raw | ConvertFrom-Json).version
    if (-not $REVERA_VERSION) { $REVERA_VERSION = "unknown" }
} catch {
    $REVERA_VERSION = "unknown"
}
Ok "Built revera v$REVERA_VERSION -> $REVERA_DIST"

# ── Set up benchmarker ────────────────────────────────────────────────────────
Info "Installing benchmarker dependencies..."
Push-Location $SCRIPT_DIR
try {
    npm install
    if ($LASTEXITCODE -ne 0) { Die "npm install failed" }
} finally {
    Pop-Location
}

Info "Compiling benchmarker TypeScript..."
Push-Location $SCRIPT_DIR
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { Die "TypeScript compilation failed" }
} finally {
    Pop-Location
}

# ── Run benchmarks ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ──────────────────────────────────────────────" -ForegroundColor DarkGray
Info "Starting benchmark"
Write-Host "  Workers   : $Workers" -ForegroundColor DarkGray
Write-Host "  Threshold : $Threshold" -ForegroundColor DarkGray
Write-Host "  Output    : $OutputDir" -ForegroundColor DarkGray
Write-Host "  ──────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

$resumeArgs = @()
if ($RESUME_ID) {
    $resumeArgs = @("--resume", $RESUME_ID)
}

$runnerArgs = @(
    (Join-Path $SCRIPT_DIR "dist/runner.js"),
    "--revera-dist", $REVERA_DIST,
    "--dataset", $Dataset,
    "--workers", $Workers,
    "--output-dir", $OutputDir,
    "--threshold", $Threshold
) + $resumeArgs

node @runnerArgs
if ($LASTEXITCODE -ne 0) { Die "Benchmark run failed" }

}
finally {
    # Always clean up, even on error or Ctrl+C — equivalent of bash's trap cleanup EXIT INT TERM
    Cleanup
}
