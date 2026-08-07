# AGENTS.md

- Implement the latest goal and plan under `goals/` and `plans/` (`v0.5` or later).
- `/home/gaiah/work/pbgr` is a read-only UI and interaction reference. Never modify it.
- Keep this project standalone and use only vanilla HTML/CSS/JavaScript plus Python/yfinance.
- Follow TDD for valuation behavior and verify both Python and JavaScript implementations.
- PEGR uses the conventional PEG definition: `current PER / expected EPS CAGR expressed as a percent number`.
- Use the latest actual annual net income attributable to common stockholders, current total shares, and current total market capitalization to derive EPS and PER.
- Use `1.000` as the formula's reference point, but never describe it as an automatic cheap/fair-value verdict.
- Do not derive fair price, fair market cap, or valuation gap from PEGR 1.0.
- Do not weaken or remove tests to make failures pass.
- Do not commit secrets, generated caches, virtual environments, or temporary browser artifacts.
- Use concise conventional commit messages.
