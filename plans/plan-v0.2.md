# PEGR v0.2 구현계획 — PBGR 한국 종목 통합

## Task 1. 종목·데이터 가용성 확인

- PBGR의 최신 `config.json`에서 한국 종목 22개와 순서 확보
- 각 종목의 Yahoo Finance `.KS`·`.KQ` 티커 확인
- 최근 양(+)의 총순이익 2개 이상과 현금흐름표 행 확인

## Task 2. 한국 데이터 생성

- `config.json`에 KR 시장 설정과 22개 종목 추가
- 네이버 금융 종가·상장주식수 수집
- Yahoo Finance 총순이익·배당·자사주매입·주식발행 정규화
- 상세 자본거래 행이 없으면 순보통주발행 행으로 보완
- KR·US 시장 설정과 통합 종목 배열을 `pegr_data.json`에 생성

## Task 3. 화면 확장

- 한국·미국 섹션과 시장별 요구수익률·10년 후 PER 제공
- KRW·USD 표시 형식 분리
- 시장별 설정 저장과 종목별 시장 내재 순이익 CAGR 편집·초기화 유지

## Task 4. 검증

- Python 단위·계약 테스트
- JavaScript 계산·통화 형식 테스트
- PBGR 22개 코드·순서 및 전체 25개 종목 검증
- Python·JavaScript 실데이터 계산 동등성 확인
- 브라우저 행 수, 초기 PEGR, 잘림·콘솔 오류, 시장별 독립 동작 확인

## Task 5. 배포

- 변경사항 커밋·푸시
- Update PEGR Data workflow 수동 실행
- Pages 성공 후 실페이지에서 한국 22개·미국 3개와 상호작용 재검증
