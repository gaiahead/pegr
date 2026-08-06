# AGENTS.md

- Implement the latest goal and plan under `goals/` and `plans/` (`v0.4` or later).
- `/home/gaiah/work/pbgr` is a read-only UI and interaction reference. Never modify it.
- Keep this project standalone and use only vanilla HTML/CSS/JavaScript plus Python/yfinance.
- Follow TDD for valuation behavior and verify both Python and JavaScript implementations.
- Use the latest actual annual net income attributable to common stockholders and total market capitalization, not EPS growth or a multi-year median.
- Do not use shareholder payout, dividends, repurchases, or issuance in the PEGR valuation.
- Do not weaken or remove tests to make failures pass.
- Do not commit secrets, generated caches, virtual environments, or temporary browser artifacts.
- Use concise conventional commit messages.
