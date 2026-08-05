# PEGR — 한국·미국 주식 가치평가 모니터

총순이익 성장과 배당·순자사주매입을 함께 반영해 한국·미국 상장기업의 10년 적정 시가총액을 계산하는 정적 대시보드입니다.

> 이 프로젝트의 PEGR은 독자적인 `Price to Earnings Growth Ratio`이며, 일반적인 PEG(`PER ÷ EPS 성장률`)와 다릅니다.

## 계산 방법

```text
E_t = 정규화 총순이익 × (1 + 시장 평가 이익 CAGR)^t
주주환원_t = E_t × 지속 가능 주주환원율

적정 시가총액
= 향후 10년 주주환원액의 현재가치 합계
+ 10년 후 총순이익 × 종료 PER의 현재가치

PEGR = 현재 시가총액 ÷ 적정 시가총액
괴리율 = 적정 시가총액 ÷ 현재 시가총액 - 1
```

- **정규화 총순이익:** 최근 양수인 연간 총순이익 3개의 중앙값. 2개 미만이면 계산하지 않습니다.
- **주주환원율:** 최근 최대 3년의 `(현금배당 + 자사주매입 - 주식발행) ÷ 총순이익` 중앙값을 0~100%로 제한합니다.
- **시장 평가:** 초기에는 현재 종가가 내포한 10년 총순이익 CAGR을 역산합니다. 종목별 수정·초기화가 가능합니다.
- **종료 PER:** 10년 후 총순이익에 적용할 공통 배수입니다.
- EPS가 아닌 총순이익과 총시가총액을 사용해 자사주매입에 따른 EPS 증가를 이중 반영하지 않습니다.

초기 시장 평가에서는 현재가를 역산하므로 PEGR은 `1.000`, 괴리율은 `0.0%`입니다. 사용자가 시장 평가를 수정하면 적정 시가총액·PEGR·괴리율·적정가가 함께 바뀝니다.

## 대상 종목

- 한국: PBGR이 추적하는 22개 종목
- 미국: Apple (`AAPL`), Microsoft (`MSFT`), Berkshire Hathaway Class B (`BRK-B`)
- 한국과 미국은 요구수익률과 10년 후 PER을 시장별로 따로 설정합니다.

## 데이터

- 한국 가격·상장주식수: 네이버 금융
- 한국 재무제표: Yahoo Finance의 한국 거래소 티커(`.KS`, `.KQ`)
- 미국 가격·주식수·재무제표: `yfinance`
- 미국 가격: `regularMarketPreviousClose` 우선, `previousClose`, `lastPrice` 순서
- 한국 종목의 우선주가 설정된 경우 보통주와 우선주 상장주식수를 합산합니다.
- 총순이익: `Net Income Common Stockholders` 우선
- 배당·자사주매입·주식발행: 연간 현금흐름표
- 출력: `pegr_data.json`

GitHub Actions가 매일 KST 07:10에 테스트를 실행하고 데이터를 갱신합니다. GitHub Pages는 저장소의 정적 HTML/CSS/JavaScript/JSON을 제공합니다.

## 로컬 실행

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python gen_pegr_data.py
python -m unittest -v test_pegr.py
node --check app.js
node test_app.js
python -m http.server 8767
```

브라우저에서 `http://127.0.0.1:8767/`을 엽니다.

## 파일

- `gen_pegr_data.py` — 데이터 수집·정규화·Python 가치평가 엔진
- `pegr_data.json` — 생성된 정적 데이터
- `app.js` — JavaScript 가치평가 엔진·상호작용
- `index.html`, `style.css` — 정적 대시보드
- `test_pegr.py`, `test_app.js` — 계산·데이터·UI 계약 테스트
- `config.json` — 공통 가정과 종목 목록

## 한계

- 종료 PER과 이익 CAGR은 가치평가 결과에 큰 영향을 줍니다.
- 주주환원율은 과거 현금흐름을 정규화한 값이며 미래 지속을 보장하지 않습니다.
- 차입으로 조달한 자사주매입, 대규모 인수, 주식보상, 일회성 손익을 완전히 제거하지 못합니다.
- 한국 종목의 재무제표 행과 단위는 Yahoo Finance 제공 범위에 의존합니다.
- Berkshire Hathaway처럼 투자자산 평가손익이 총순이익에 크게 반영되는 기업은 별도 검토가 필요합니다.
- 적자기업·리츠·금융회사는 각각 다른 평가방식이 더 적합할 수 있습니다.
- 투자 판단을 대신하지 않습니다.
