# PEGR v0.1 Implementation Plan

> **For Hermes:** Use Codex CLI to implement this plan task-by-task, then independently review and verify every result.

**Goal:** Build and deploy an independent US-stock PEGR valuation dashboard that preserves PBGR's editable market-implied-growth interaction while valuing normalized total earnings plus sustainable shareholder payouts.

**Architecture:** A Python generator uses yfinance to create a strict static `pegr_data.json`. Pure Python and JavaScript valuation functions implement the same 10-year payout-plus-terminal-PER model. Static HTML/CSS/JS renders the dashboard and persists common assumptions and per-ticker growth overrides in localStorage; GitHub Actions refreshes data and GitHub Pages serves the repository root.

**Tech Stack:** Python 3.11, yfinance, unittest, vanilla JavaScript/Node assert, HTML/CSS, GitHub Actions, GitHub Pages.

---

### Task 1: Create project contracts and configuration

**Objective:** Define the initial US assets, common assumptions, dependencies, and repository safety rules.

**Files:**
- Create: `AGENTS.md`
- Create: `config.json`
- Create: `requirements.txt`
- Create: `.gitignore`

**Steps:**
1. Set `required_return` to `0.10`, `terminal_pe` to `15`, horizon to `10`, and assets to AAPL/MSFT/BRK-B with Korean display names or familiar English corporate names.
2. Pin only the minimum runtime dependency `yfinance`; avoid frameworks and build systems.
3. State that `/home/gaiah/work/pbgr` is read-only reference and must never be modified.
4. Validate JSON with `python3 -m json.tool config.json`.
5. Commit as `chore: initialize PEGR project`.

### Task 2: Implement the Python valuation engine with TDD

**Objective:** Implement deterministic PEGR fair-value and implied-growth calculations before network collection.

**Files:**
- Create: `gen_pegr_data.py`
- Create: `test_pegr.py`

**Steps:**
1. Write failing tests for `fair_value`, `implied_earnings_cagr`, invalid inputs, payout contribution, and repricing to PEGR 1.000.
2. Run `python3 -m unittest -v test_pegr.py` and verify failure for missing functions.
3. Implement:
   - `E_t = E0 * (1+g)^t`
   - annual payout PV for years 1..10
   - terminal value `E_10 * terminal_pe` discounted 10 years
   - fair price, PEGR, gap, and year-10 earnings
   - bisection/expanding-upper-bound inverse solver for market-implied CAGR
4. Reject non-finite values, nonpositive normalized income/shares/price, `g <= -100%`, required return `<= -100%`, terminal PER `<= 0`, and payout outside 0..100% after normalization.
5. Verify the test suite passes and commit `feat: add PEGR valuation engine`.

### Task 3: Implement yfinance data normalization with fixture tests

**Objective:** Generate robust per-stock normalized earnings and sustainable payout data without relying on live calls in unit tests.

**Files:**
- Modify: `gen_pegr_data.py`
- Modify: `test_pegr.py`

**Steps:**
1. Add fixture-based failing tests for row-name fallbacks, annual date alignment, three-year median normalized income, net payout calculation, 0..100% clamp, and previous-data fallback.
2. Implement pure helpers for statement-row selection and numeric cleaning.
3. Resolve price in order `regularMarketPreviousClose`, `previousClose`, `lastPrice`; resolve shares from fast_info then info.
4. Resolve net income in order `Net Income Common Stockholders`, `Net Income`, `Normalized Income`.
5. Resolve cash dividends, repurchases, and issuance with documented row fallbacks; calculate annual net payout and median payout ratio over aligned positive-income years.
6. Preserve prior valid asset data when a ticker fetch fails, while recording a warning/source note.
7. Write strict JSON with no NaN/Infinity and include audit series and row-source names.
8. Run tests and commit `feat: generate normalized US PEGR data`.

### Task 4: Generate and validate initial live data

**Objective:** Produce working AAPL/MSFT/BRK-B data from live yfinance.

**Files:**
- Create: `pegr_data.json`

**Steps:**
1. Run `python3 gen_pegr_data.py` against live data.
2. Validate strict JSON with `python3 -m json.tool pegr_data.json`.
3. Assert all configured tickers exist, normalized income and shares are positive, payout ratio is within 0..100%, and implied CAGR/PEGR/fair price are finite.
4. Inspect warnings and fix data-row fallbacks rather than accepting silent missing values.
5. Commit `data: add initial PEGR dataset`.

### Task 5: Implement the browser calculation engine with TDD

**Objective:** Mirror Python valuation behavior and local override semantics in JavaScript.

**Files:**
- Create: `app.js`
- Create: `test_app.js`

**Steps:**
1. Write failing Node assertions for fair value, inverse implied CAGR, repricing to PEGR 1, payout contribution, override normalization, isolated reset, and common-setting changes.
2. Run `node test_app.js` and verify failure for missing exports.
3. Implement pure exported functions before DOM code.
4. Use total market cap and total earnings; do not use EPS growth.
5. Persist `required_return`, `terminal_pe`, and `market_cagr_overrides` under a PEGR-specific localStorage key.
6. Preserve explicit per-ticker overrides when common assumptions change; recalculate implied defaults only for untouched rows.
7. Run `node --check app.js && node test_app.js` and commit `feat: add interactive PEGR calculations`.

### Task 6: Build the static dashboard UI

**Objective:** Render the tested engine in a simple PBGR-like table without copying PBGR domain labels.

**Files:**
- Create: `index.html`
- Create: `style.css`
- Modify: `app.js`
- Modify: `test_pegr.py`

**Steps:**
1. Write UI contract tests for title, labels, column order, single editable market-evaluation field, reset control, note wording, and absence of PBGR/book-equity labels.
2. Build top controls for required return, terminal PER, 10-year discount hint, save state.
3. Build the exact table order from `goal-v0.1.md`, grouping only the two earnings columns.
4. Format USD prices, billion/trillion market caps and earnings, percentages, ratios, and share counts.
5. Use flat white/light-gray surfaces, consistent typography, fixed lower-bound column widths, and horizontal scrolling; no gradients or decorative shadows.
6. Update rows in place while editing to preserve input focus.
7. Version `style.css`, `app.js`, and nested `pegr_data.json` URLs for cache busting.
8. Run Python/Node tests and commit `feat: build PEGR dashboard`.

### Task 7: Add scheduled refresh and documentation

**Objective:** Make the standalone repository understandable and self-updating.

**Files:**
- Create: `.github/workflows/update.yml`
- Create: `README.md`

**Steps:**
1. Schedule daily UTC 22:10 / KST 07:10 plus workflow_dispatch.
2. Install from `requirements.txt`, run unit tests, generate data, validate JSON, commit only changed `pegr_data.json`, and push with contents write permission.
3. Document formula, fields, data normalization, limitations, local commands, and Pages architecture.
4. Explicitly state that PEGR is a project-specific valuation ratio, not conventional PEG.
5. Run a final source scan for stale PBGR/book-equity wording and commit `ci: automate PEGR data refresh`.

### Task 8: Independent verification and GitHub deployment

**Objective:** Publish a verified public artifact rather than stopping at local code.

**Files:**
- Modify only if verification finds defects.

**Steps:**
1. Review `git diff`, repository history, generated data, and all tests independently of Codex's self-report.
2. Run:
   - `python3 -m unittest -v test_pegr.py`
   - `node --check app.js`
   - `node test_app.js`
   - `python3 -m json.tool config.json`
   - `python3 -m json.tool pegr_data.json`
3. Serve locally and verify three rows, PEGR 1.000 defaults, growth edit, reset, common inputs, persistence, no console errors, no NaN/Infinity, no clipped or overlapping cells.
4. Create public `gaiahead/pegr`, set origin, push `main`, configure Pages from main/root, and run the update workflow manually.
5. Wait for Actions/Pages completion and verify the live cache-busted URL, asset versions, row count, interactions, computed styles, and console.
6. Report repository URL, live URL, commit SHA, Actions result, and measured verification results.
