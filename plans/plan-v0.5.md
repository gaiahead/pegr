# PEGR v0.5 구현계획 — 전통 PEG 의미 복원

## Task 1. 계산 계약 테스트

- `PER 15 / 성장률 15 = 1`, `20 / 10 = 2`, `10 / 20 = 0.5`를 Python·JavaScript 테스트에 먼저 반영합니다.
- 최신 실제 순이익·현재 주식수로 EPS와 PER을 계산하는 계약을 검증합니다.
- 순이익·성장률 0 이하와 비정상 입력을 계산 불가로 검증합니다.
- 기본 시장 내재 EPS CAGR이 현재 PER과 같아 PEGR `1.000`이 되는지 검증합니다.

## Task 2. 생성기·데이터 마이그레이션

- 10년 종료가치·할인·요구수익률 계산을 제거합니다.
- 자산별 `latest_eps`, `current_per`, `market_implied_eps_cagr_pct`, `pegr`를 생성합니다.
- `fair_market_cap`, `fair_price`, `gap`, `valuation_multiple`, `current_net_income`, `earnings_10`, `terminal_pv`, `elapsed_years`를 제거합니다.
- 설정에서 `required_return`, `terminal_pe`, `horizon_years`를 제거합니다.

## Task 3. 화면·저장·문서 마이그레이션

- 표를 `종목 → 시가총액 → PER → 예상 EPS CAGR → PEGR → 종가 → 최근 EPS → 최근 순이익 → 주식수`로 단순화합니다.
- PEGR은 무단위 세 자리 소수로 표시하고 `1.000`을 기준으로 구분합니다.
- 저평가·고평가 대신 성장 대비 낮음·기준·높음 의미만 안내합니다.
- 새 localStorage 키와 EPS CAGR 오버라이드 맵을 사용해 구형 의미의 저장값을 재해석하지 않습니다.
- README·AGENTS·캐시 버전을 v0.5 계약으로 맞춥니다.

## Task 4. 검증·배포

- Python·Node 테스트, 문법, strict JSON, diff 검사를 실행합니다.
- 데이터를 재생성하고 26개 전 종목의 초기 PEGR `1.000`과 Python·JavaScript 동등성을 검증합니다.
- 로컬 브라우저에서 행 수, 편집·초기화·저장, 잘림·겹침·NaN·콘솔 오류를 확인합니다.
- 커밋·푸시 후 데이터 workflow를 실행하고 봇 데이터 커밋까지 반영합니다.
- 최종 Pages head SHA와 실서비스 CSS·JS·JSON을 확인하고 같은 브라우저 검증을 반복합니다.
