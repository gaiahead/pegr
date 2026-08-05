/* PEGR 가치평가 모니터 */
const LS_KEY = 'pegr_settings_v1';
let rawData = null;
let marketCagrOverrides = {};

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function fairMarketCap(
  normalizedIncome,
  earningsCagrPct,
  payoutRatioPct,
  requiredReturnPct,
  terminalPe,
  horizonYears = 10,
) {
  const values = [
    normalizedIncome,
    earningsCagrPct,
    payoutRatioPct,
    requiredReturnPct,
    terminalPe,
    horizonYears,
  ];
  if (!values.every(isFiniteNumber)) return null;
  const income = Number(normalizedIncome);
  const growthPct = Number(earningsCagrPct);
  const payoutPct = Number(payoutRatioPct);
  const requiredPct = Number(requiredReturnPct);
  const pe = Number(terminalPe);
  const years = Number(horizonYears);
  if (
    income <= 0 || growthPct <= -100 || payoutPct < 0 || payoutPct > 100
    || requiredPct <= -100 || pe <= 0 || years <= 0 || !Number.isInteger(years)
  ) return null;

  const growth = growthPct / 100;
  const payoutRatio = payoutPct / 100;
  const requiredReturn = requiredPct / 100;
  let payoutPv = 0;
  let earningsT = income;
  for (let year = 1; year <= years; year += 1) {
    earningsT = income * Math.pow(1 + growth, year);
    payoutPv += earningsT * payoutRatio / Math.pow(1 + requiredReturn, year);
  }
  const terminalPv = earningsT * pe / Math.pow(1 + requiredReturn, years);
  const fairValue = payoutPv + terminalPv;
  if (![payoutPv, terminalPv, fairValue, earningsT].every(Number.isFinite) || fairValue <= 0) {
    return null;
  }
  return {
    fairMarketCap: fairValue,
    payoutPv,
    terminalPv,
    earnings10: earningsT,
  };
}

function calculatePegr(
  price,
  shares,
  normalizedIncome,
  payoutRatioPct,
  earningsCagrPct,
  requiredReturnPct,
  terminalPe,
  horizonYears = 10,
) {
  if (![price, shares, normalizedIncome].every(v => isFiniteNumber(v) && Number(v) > 0)) {
    return null;
  }
  const valuation = fairMarketCap(
    normalizedIncome,
    earningsCagrPct,
    payoutRatioPct,
    requiredReturnPct,
    terminalPe,
    horizonYears,
  );
  if (!valuation) return null;
  const marketCap = Number(price) * Number(shares);
  const pegr = marketCap / valuation.fairMarketCap;
  return {
    ...valuation,
    marketCap,
    fairPrice: valuation.fairMarketCap / Number(shares),
    pegr,
    gap: 1 / pegr - 1,
  };
}

function impliedEarningsCagr(
  price,
  shares,
  normalizedIncome,
  payoutRatioPct,
  requiredReturnPct,
  terminalPe,
  horizonYears = 10,
) {
  if (![price, shares, normalizedIncome].every(v => isFiniteNumber(v) && Number(v) > 0)) {
    return null;
  }
  const target = Number(price) * Number(shares);
  const valueAt = growthPct => fairMarketCap(
    normalizedIncome,
    growthPct,
    payoutRatioPct,
    requiredReturnPct,
    terminalPe,
    horizonYears,
  )?.fairMarketCap;

  let low = -99.999999;
  let high = 25;
  let highValue = valueAt(high);
  while (Number.isFinite(highValue) && highValue < target && high < 10000) {
    high = high * 2 + 25;
    highValue = valueAt(high);
  }
  if (!Number.isFinite(highValue) || highValue < target) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const value = valueAt(mid);
    if (!Number.isFinite(value)) return null;
    if (value < target) low = mid;
    else high = mid;
  }
  const result = (low + high) / 2;
  return Number.isFinite(result) ? result : null;
}

function isValidCagrPct(value) {
  if (value == null || String(value).trim() === '') return false;
  return Number.isFinite(Number(value)) && Number(value) > -100;
}

function normalizeMarketCagrOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  Object.entries(raw).forEach(([ticker, value]) => {
    if (!/^[0-9A-Z.-]+$/.test(ticker) || !isValidCagrPct(value)) return;
    clean[ticker] = Number(value);
  });
  return clean;
}

function removeMarketCagrOverride(raw, ticker) {
  const clean = normalizeMarketCagrOverrides(raw);
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

function commonInputs() {
  const requiredReturnPct = Number(document.getElementById('req-us').value);
  const terminalPe = Number(document.getElementById('terminal-pe').value);
  return {
    requiredReturnPct: Number.isFinite(requiredReturnPct) && requiredReturnPct > -100
      ? requiredReturnPct : rawData.required_return * 100,
    terminalPe: Number.isFinite(terminalPe) && terminalPe > 0
      ? terminalPe : rawData.terminal_pe,
    horizonYears: Number(rawData.horizon_years) || 10,
  };
}

function saveSettings() {
  const common = commonInputs();
  const settings = {
    required_return_pct: common.requiredReturnPct,
    terminal_pe: common.terminalPe,
    market_cagr_overrides: normalizeMarketCagrOverrides(marketCagrOverrides),
  };
  marketCagrOverrides = settings.market_cagr_overrides;
  localStorage.setItem(LS_KEY, JSON.stringify(settings));
  setStatus('✓ 저장됨', '#15803d');
  const button = document.getElementById('save-btn');
  button.className = 'save-btn saved';
  button.textContent = '✓ 저장됨';
  renderTable();
}

function setStatus(message, color = '#64748b') {
  const element = document.getElementById('status-msg');
  if (!element) return;
  element.textContent = message;
  element.style.color = color;
}

function markDirty(shouldRender = true) {
  updateRequiredReturnHint();
  const button = document.getElementById('save-btn');
  button.className = 'save-btn unsaved';
  button.textContent = '● 저장';
  setStatus('수정됨', '#c2410c');
  if (shouldRender) renderTable();
}

function updateRequiredReturnHint() {
  const hint = document.getElementById('discount-hint');
  if (!hint) return;
  const requiredReturnPct = Number(document.getElementById('req-us').value);
  if (!Number.isFinite(requiredReturnPct) || requiredReturnPct <= -100) {
    hint.textContent = '할인계수 계산 불가';
    return;
  }
  const rate = 1 + requiredReturnPct / 100;
  const factor = 1 / Math.pow(rate, Number(rawData?.horizon_years) || 10);
  hint.textContent = `1 / ${rate.toFixed(2)}^${Number(rawData?.horizon_years) || 10} = ${factor.toFixed(3)}배`;
}

function fmtUsd(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value));
}

function fmtCompactUsd(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return fmtUsd(n);
}

function fmtShares(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  const n = Number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B주`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M주`;
  return `${Math.round(n).toLocaleString('en-US')}주`;
}

function pegrHtml(pegr) {
  if (!Number.isFinite(pegr) || pegr <= 0) return '—';
  const delta = pegr - 1;
  const cls = Math.abs(delta) < 0.0005 ? 'neutral' : delta < 0 ? 'under' : 'over';
  return `<span class="pegr-val ${cls}">${pegr.toFixed(3)}</span>`;
}

function gapHtml(pegr) {
  if (!Number.isFinite(pegr) || pegr <= 0) return '—';
  const raw = (1 / pegr - 1) * 100;
  const pct = Math.abs(raw) < 0.05 ? 0 : raw;
  const cls = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
  const sign = pct > 0 ? '+' : '';
  return `<span class="gap-val ${cls}">${sign}${pct.toFixed(1)}%</span>`;
}

function impliedForAsset(asset, common) {
  return impliedEarningsCagr(
    asset.price,
    asset.shares,
    asset.normalized_net_income,
    asset.shareholder_payout_ratio_pct,
    common.requiredReturnPct,
    common.terminalPe,
    common.horizonYears,
  );
}

function resolveMarketCagr(asset, common, overrides = marketCagrOverrides) {
  const saved = Object.prototype.hasOwnProperty.call(overrides, asset.ticker)
    ? overrides[asset.ticker] : null;
  return isValidCagrPct(saved) ? Number(saved) : impliedForAsset(asset, common);
}

function calculateAsset(asset, growthPct, common) {
  return calculatePegr(
    asset.price,
    asset.shares,
    asset.normalized_net_income,
    asset.shareholder_payout_ratio_pct,
    growthPct,
    common.requiredReturnPct,
    common.terminalPe,
    common.horizonYears,
  );
}

function updateRowValuation(row, calc) {
  const field = name => row.querySelector(`[data-field="${name}"]`);
  field('fair-market-cap').textContent = calc ? fmtCompactUsd(calc.fairMarketCap) : '—';
  field('pegr').innerHTML = pegrHtml(calc?.pegr);
  field('gap').innerHTML = gapHtml(calc?.pegr);
  field('fair-price').textContent = calc ? fmtUsd(calc.fairPrice) : '—';
  field('earnings-10').textContent = calc ? fmtCompactUsd(calc.earnings10) : '—';
}

function renderTable() {
  if (!rawData) return;
  const body = document.getElementById('us-body');
  const common = commonInputs();
  body.innerHTML = '';

  rawData.assets.forEach(asset => {
    const hasOverride = Object.prototype.hasOwnProperty.call(marketCagrOverrides, asset.ticker);
    const growthPct = resolveMarketCagr(asset, common);
    const calc = calculateAsset(asset, growthPct, common);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><div class="name">${asset.name}</div><div class="ticker">${asset.ticker}</div></td>
      <td class="metric-cell marketcap-cell">${fmtCompactUsd(asset.price * asset.shares)}</td>
      <td class="metric-cell market-eval-cell">
        <span class="market-cagr-editor">
          <input class="market-cagr-input" type="number" step="0.01"
            value="${isValidCagrPct(growthPct) ? Number(growthPct).toFixed(2) : ''}"
            aria-label="${asset.name} 시장 평가 이익 CAGR"
            title="PEGR·적정가·괴리율에 적용하는 10년 이익 CAGR">
          <span class="unit">%</span>
          <button class="market-cagr-reset" type="button"
            aria-label="${asset.name} 시장 평가 초기화"
            title="${asset.name} 시장 평가 초기화"
            ${hasOverride ? '' : 'disabled'}>↺</button>
        </span>
      </td>
      <td class="metric-cell fair-marketcap-cell" data-field="fair-market-cap">${calc ? fmtCompactUsd(calc.fairMarketCap) : '—'}</td>
      <td data-field="pegr">${pegrHtml(calc?.pegr)}</td>
      <td data-field="gap">${gapHtml(calc?.pegr)}</td>
      <td>${fmtUsd(asset.price)}</td>
      <td data-field="fair-price">${calc ? fmtUsd(calc.fairPrice) : '—'}</td>
      <td class="metric-cell earnings-cell">${fmtCompactUsd(asset.normalized_net_income)}</td>
      <td class="metric-cell earnings-cell" data-field="earnings-10">${calc ? fmtCompactUsd(calc.earnings10) : '—'}</td>
      <td class="metric-cell payout-cell">${Number(asset.shareholder_payout_ratio_pct).toFixed(1)}%</td>
      <td class="metric-cell shares-cell">${fmtShares(asset.shares)}</td>
    `;

    const input = row.querySelector('.market-cagr-input');
    const reset = row.querySelector('.market-cagr-reset');
    const restoreImplied = () => {
      marketCagrOverrides = removeMarketCagrOverride(marketCagrOverrides, asset.ticker);
      const currentCommon = commonInputs();
      const implied = resolveMarketCagr(asset, currentCommon);
      input.value = isValidCagrPct(implied) ? Number(implied).toFixed(2) : '';
      reset.disabled = true;
      updateRowValuation(row, calculateAsset(asset, implied, currentCommon));
    };

    input.addEventListener('input', () => {
      const raw = input.value.trim();
      const value = raw === '' ? null : Number(raw);
      let editedCalc = null;
      if (isValidCagrPct(value)) {
        marketCagrOverrides[asset.ticker] = value;
        reset.disabled = false;
        editedCalc = calculateAsset(asset, value, commonInputs());
      } else {
        marketCagrOverrides = removeMarketCagrOverride(marketCagrOverrides, asset.ticker);
        reset.disabled = true;
      }
      updateRowValuation(row, editedCalc);
      markDirty(false);
    });
    input.addEventListener('change', () => {
      if (!isValidCagrPct(input.value.trim())) restoreImplied();
    });
    reset.addEventListener('click', () => {
      restoreImplied();
      markDirty(false);
      input.focus();
    });

    body.appendChild(row);
  });
}

async function init() {
  try {
    rawData = await fetch('pegr_data.json?v=pegr-v01-20260805').then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    document.getElementById('updated').textContent = rawData.updated;
    const settings = loadSettings();
    marketCagrOverrides = normalizeMarketCagrOverrides(settings.market_cagr_overrides);
    const savedRequired = Number(settings.required_return_pct);
    const savedTerminalPe = Number(settings.terminal_pe);
    document.getElementById('req-us').value = Number.isFinite(savedRequired) && savedRequired > -100
      ? savedRequired : rawData.required_return * 100;
    document.getElementById('terminal-pe').value = Number.isFinite(savedTerminalPe) && savedTerminalPe > 0
      ? savedTerminalPe : rawData.terminal_pe;
    updateRequiredReturnHint();
    document.getElementById('req-us').addEventListener('input', () => markDirty(true));
    document.getElementById('terminal-pe').addEventListener('input', () => markDirty(true));
    renderTable();
  } catch (error) {
    setStatus(`데이터 로드 실패: ${error.message}`, '#dc2626');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fairMarketCap,
    calculatePegr,
    impliedEarningsCagr,
    normalizeMarketCagrOverrides,
    removeMarketCagrOverride,
    isValidCagrPct,
  };
}
if (typeof document !== 'undefined') init();
