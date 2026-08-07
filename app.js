/* PEGR 가치평가 모니터 — conventional PEG semantics */
const LS_KEY = 'pegr_settings_v3';
let rawData = null;
let epsCagrOverrides = {};

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function calculatePer(price, shares, latestNetIncome) {
  const values = [price, shares, latestNetIncome];
  if (!values.every(value => isFiniteNumber(value) && Number(value) > 0)) return null;
  const marketCap = Number(price) * Number(shares);
  const latestEps = Number(latestNetIncome) / Number(shares);
  const currentPer = Number(price) / latestEps;
  if (![marketCap, latestEps, currentPer].every(value => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return { marketCap, latestEps, currentPer };
}

function calculatePegr(price, shares, latestNetIncome, epsCagrPct) {
  const per = calculatePer(price, shares, latestNetIncome);
  if (!per || !isFiniteNumber(epsCagrPct) || Number(epsCagrPct) <= 0) return null;
  const pegr = per.currentPer / Number(epsCagrPct);
  if (!Number.isFinite(pegr) || pegr <= 0) return null;
  return { ...per, epsCagrPct: Number(epsCagrPct), pegr };
}

function impliedEpsCagr(price, shares, latestNetIncome) {
  const per = calculatePer(price, shares, latestNetIncome);
  return per ? per.currentPer : null;
}

function isValidEpsCagrPct(value) {
  if (value == null || String(value).trim() === '') return false;
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function normalizeEpsCagrOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  Object.entries(raw).forEach(([ticker, value]) => {
    if (!/^[0-9A-Z.-]+$/.test(ticker) || !isValidEpsCagrPct(value)) return;
    clean[ticker] = Number(value);
  });
  return clean;
}

function removeEpsCagrOverride(raw, ticker) {
  const clean = normalizeEpsCagrOverrides(raw);
  delete clean[String(ticker)];
  return clean;
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSettings() {
  const settings = {
    eps_cagr_overrides: normalizeEpsCagrOverrides(epsCagrOverrides),
  };
  epsCagrOverrides = settings.eps_cagr_overrides;
  localStorage.setItem(LS_KEY, JSON.stringify(settings));
  setStatus('✓ 저장됨', '#15803d');
  const button = document.getElementById('save-btn');
  button.className = 'save-btn saved';
  button.textContent = '✓ 저장됨';
  renderAllMarkets();
}

function setStatus(message, color = '#64748b') {
  const element = document.getElementById('status-msg');
  if (!element) return;
  element.textContent = message;
  element.style.color = color;
}

function markDirty() {
  const button = document.getElementById('save-btn');
  button.className = 'save-btn unsaved';
  button.textContent = '● 저장';
  setStatus('수정됨', '#c2410c');
}

function fmtPrice(value, currency, decimals = null) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (currency === 'KRW') {
    const digits = decimals == null ? (Math.abs(n) < 100 ? 2 : 0) : decimals;
    return `${n.toLocaleString('ko-KR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}원`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals == null ? 2 : decimals,
    maximumFractionDigits: decimals == null ? 2 : decimals,
  }).format(n);
}

function fmtCompactMoney(value, currency) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (currency === 'KRW') {
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}조`;
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
    if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}만`;
    return `${Math.round(n).toLocaleString('ko-KR')}원`;
  }
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return fmtPrice(n, currency);
}

function fmtShares(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  const n = Number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B주`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M주`;
  return `${Math.round(n).toLocaleString('en-US')}주`;
}

function fmtPer(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
    ? `${Number(value).toFixed(2)}배`
    : '—';
}

function pegrHtml(pegr) {
  if (!Number.isFinite(Number(pegr)) || Number(pegr) <= 0) return '—';
  const value = Number(pegr);
  const delta = value - 1;
  const cls = Math.abs(delta) < 0.0005
    ? 'neutral'
    : delta < 0 ? 'growth-low' : 'growth-high';
  const meaning = Math.abs(delta) < 0.0005
    ? '정의상 기준점'
    : delta < 0 ? '성장 대비 PER 낮음' : '성장 대비 PER 높음';
  return `<span class="pegr-val ${cls}" title="${meaning}">${value.toFixed(3)}</span>`;
}

function resolveEpsCagr(asset, overrides = epsCagrOverrides) {
  if (!(Number(asset.latest_net_income) > 0)) return null;
  const saved = Object.prototype.hasOwnProperty.call(overrides, asset.ticker)
    ? overrides[asset.ticker]
    : null;
  if (isValidEpsCagrPct(saved)) return Number(saved);
  return impliedEpsCagr(asset.price, asset.shares, asset.latest_net_income);
}

function calculateAsset(asset, growthPct) {
  return calculatePegr(
    asset.price,
    asset.shares,
    asset.latest_net_income,
    growthPct,
  );
}

function updateRowPegr(row, calc) {
  const field = row.querySelector('[data-field="pegr"]');
  if (field) field.innerHTML = pegrHtml(calc?.pegr);
}

function renderMarket(market) {
  if (!rawData) return;
  const body = document.getElementById(`${market.toLowerCase()}-body`);
  body.innerHTML = '';

  rawData.assets.filter(asset => asset.market === market).forEach(asset => {
    const canValue = Number(asset.latest_net_income) > 0;
    const hasOverride = canValue
      && Object.prototype.hasOwnProperty.call(epsCagrOverrides, asset.ticker);
    const growthPct = resolveEpsCagr(asset);
    const calc = calculateAsset(asset, growthPct);
    const per = calculatePer(asset.price, asset.shares, asset.latest_net_income);
    const incomeYear = String(asset.latest_net_income_date || '').slice(0, 4);
    const incomeTitle = asset.latest_net_income_date
      ? `${asset.latest_net_income_date} 최신 실제 연간 지배주주순이익`
      : '최신 실제 연간 지배주주순이익';

    const row = document.createElement('tr');
    row.dataset.ticker = asset.ticker;
    row.innerHTML = `
      <td><div class="name">${asset.name}</div><div class="ticker">${asset.ticker}</div></td>
      <td class="metric-cell marketcap-cell">${fmtCompactMoney(asset.market_cap, asset.currency)}</td>
      <td class="metric-cell per-cell">${fmtPer(per?.currentPer)}</td>
      <td class="metric-cell eps-growth-cell">
        <span class="eps-cagr-editor">
          <input class="eps-cagr-input" type="number" step="0.01" min="0.01"
            value="${isValidEpsCagrPct(growthPct) ? Number(growthPct).toFixed(2) : ''}"
            aria-label="${asset.name} 예상 EPS CAGR"
            title="PEGR에 적용하는 예상 EPS 연평균 성장률. 초기값은 PEGR 1.000을 만드는 현재 PER입니다."
            ${canValue ? '' : 'disabled'}>
          <span class="unit">%</span>
          <button class="eps-cagr-reset" type="button"
            aria-label="${asset.name} 예상 EPS CAGR 초기화"
            title="${asset.name} PEGR 1.000 기준값으로 초기화"
            ${hasOverride && canValue ? '' : 'disabled'}>↺</button>
        </span>
      </td>
      <td data-field="pegr">${pegrHtml(calc?.pegr)}</td>
      <td>${fmtPrice(asset.price, asset.currency)}</td>
      <td class="metric-cell eps-cell">${per ? fmtPrice(per.latestEps, asset.currency, 2) : '—'}</td>
      <td class="metric-cell earnings-cell" title="${incomeTitle}">
        <div>${fmtCompactMoney(asset.latest_net_income, asset.currency)}</div>
        <div class="earnings-period">${incomeYear || '—'}</div>
      </td>
      <td class="metric-cell shares-cell">${fmtShares(asset.shares)}</td>
    `;

    const input = row.querySelector('.eps-cagr-input');
    const reset = row.querySelector('.eps-cagr-reset');
    const restoreImplied = () => {
      epsCagrOverrides = removeEpsCagrOverride(epsCagrOverrides, asset.ticker);
      const implied = resolveEpsCagr(asset);
      input.value = isValidEpsCagrPct(implied) ? Number(implied).toFixed(2) : '';
      reset.disabled = true;
      updateRowPegr(row, calculateAsset(asset, implied));
    };

    input.addEventListener('input', () => {
      const value = input.value.trim() === '' ? null : Number(input.value);
      let editedCalc = null;
      if (isValidEpsCagrPct(value)) {
        epsCagrOverrides[asset.ticker] = value;
        reset.disabled = false;
        editedCalc = calculateAsset(asset, value);
      } else {
        epsCagrOverrides = removeEpsCagrOverride(epsCagrOverrides, asset.ticker);
        reset.disabled = true;
      }
      updateRowPegr(row, editedCalc);
      markDirty();
    });
    input.addEventListener('change', () => {
      if (!isValidEpsCagrPct(input.value.trim())) restoreImplied();
    });
    reset.addEventListener('click', () => {
      restoreImplied();
      markDirty();
      input.focus();
    });

    body.appendChild(row);
  });
}

function renderAllMarkets() {
  Object.keys(rawData.market_settings).forEach(renderMarket);
}

async function init() {
  try {
    rawData = await fetch('pegr_data.json?v=pegr-v05-20260807').then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    document.getElementById('updated').textContent = rawData.updated;
    const settings = loadSettings();
    epsCagrOverrides = normalizeEpsCagrOverrides(settings.eps_cagr_overrides);
    renderAllMarkets();
  } catch (error) {
    setStatus(`데이터 로드 실패: ${error.message}`, '#dc2626');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculatePer,
    calculatePegr,
    impliedEpsCagr,
    normalizeEpsCagrOverrides,
    removeEpsCagrOverride,
    isValidEpsCagrPct,
    fmtPrice,
    fmtCompactMoney,
  };
}
if (typeof document !== 'undefined') init();
