/* PEGR 가치평가 모니터 */
const LS_KEY = 'pegr_settings_v2';
const LEGACY_LS_KEY = 'pegr_settings_v1';
let rawData = null;
let marketCagrOverrides = {};

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function fairMarketCap(
  latestNetIncome,
  earningsCagrPct,
  requiredReturnPct,
  terminalPe,
  horizonYears = 10,
) {
  const values = [
    latestNetIncome,
    earningsCagrPct,
    requiredReturnPct,
    terminalPe,
    horizonYears,
  ];
  if (!values.every(isFiniteNumber)) return null;
  const income = Number(latestNetIncome);
  const growthPct = Number(earningsCagrPct);
  const requiredPct = Number(requiredReturnPct);
  const pe = Number(terminalPe);
  const years = Number(horizonYears);
  if (
    income <= 0 || growthPct <= -100 || requiredPct <= -100
    || pe <= 0 || years <= 0 || !Number.isInteger(years)
  ) return null;

  const earningsT = income * Math.pow(1 + growthPct / 100, years);
  const terminalPv = earningsT * pe / Math.pow(1 + requiredPct / 100, years);
  if (![terminalPv, earningsT].every(Number.isFinite) || terminalPv <= 0) return null;
  return {
    fairMarketCap: terminalPv,
    terminalPv,
    earnings10: earningsT,
  };
}

function calculatePegr(
  price,
  shares,
  latestNetIncome,
  earningsCagrPct,
  requiredReturnPct,
  terminalPe,
  horizonYears = 10,
) {
  if (![price, shares, latestNetIncome].every(v => isFiniteNumber(v) && Number(v) > 0)) {
    return null;
  }
  const valuation = fairMarketCap(
    latestNetIncome,
    earningsCagrPct,
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
  latestNetIncome,
  requiredReturnPct,
  terminalPe,
  horizonYears = 10,
) {
  const values = [price, shares, latestNetIncome, requiredReturnPct, terminalPe, horizonYears];
  if (!values.every(isFiniteNumber)) return null;
  const years = Number(horizonYears);
  if (
    Number(price) <= 0 || Number(shares) <= 0 || Number(latestNetIncome) <= 0
    || Number(requiredReturnPct) <= -100 || Number(terminalPe) <= 0
    || years <= 0 || !Number.isInteger(years)
  ) return null;

  const target = Number(price) * Number(shares);
  const growthFactor = Math.pow(
    target * Math.pow(1 + Number(requiredReturnPct) / 100, years)
      / (Number(latestNetIncome) * Number(terminalPe)),
    1 / years,
  );
  const result = (growthFactor - 1) * 100;
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
    const current = localStorage.getItem(LS_KEY);
    if (current) return JSON.parse(current);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LS_KEY) || '{}');
    if (!legacy || typeof legacy !== 'object') return {};
    return {
      market_settings: {
        US: {
          required_return_pct: legacy.required_return_pct,
          terminal_pe: legacy.terminal_pe,
        },
      },
      market_cagr_overrides: legacy.market_cagr_overrides,
    };
  } catch {
    return {};
  }
}

function defaultMarketSettings(market) {
  return rawData?.market_settings?.[market] || {
    required_return: 0.10,
    terminal_pe: 15,
    horizon_years: 10,
    currency: market === 'KR' ? 'KRW' : 'USD',
  };
}

function commonInputs(market) {
  const key = market.toLowerCase();
  const defaults = defaultMarketSettings(market);
  const requiredReturnPct = Number(document.getElementById(`req-${key}`).value);
  const terminalPe = Number(document.getElementById(`terminal-pe-${key}`).value);
  return {
    requiredReturnPct: Number.isFinite(requiredReturnPct) && requiredReturnPct > -100
      ? requiredReturnPct : Number(defaults.required_return) * 100,
    terminalPe: Number.isFinite(terminalPe) && terminalPe > 0
      ? terminalPe : Number(defaults.terminal_pe),
    horizonYears: Number(defaults.horizon_years) || 10,
  };
}

function saveSettings() {
  const marketSettings = {};
  Object.keys(rawData.market_settings).forEach(market => {
    const common = commonInputs(market);
    marketSettings[market] = {
      required_return_pct: common.requiredReturnPct,
      terminal_pe: common.terminalPe,
    };
  });
  const settings = {
    market_settings: marketSettings,
    market_cagr_overrides: normalizeMarketCagrOverrides(marketCagrOverrides),
  };
  marketCagrOverrides = settings.market_cagr_overrides;
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

function markDirty(market, shouldRender = true) {
  updateRequiredReturnHint(market);
  const button = document.getElementById('save-btn');
  button.className = 'save-btn unsaved';
  button.textContent = '● 저장';
  setStatus('수정됨', '#c2410c');
  if (shouldRender) renderMarket(market);
}

function updateRequiredReturnHint(market) {
  const key = market.toLowerCase();
  const hint = document.getElementById(`discount-hint-${key}`);
  if (!hint) return;
  const requiredReturnPct = Number(document.getElementById(`req-${key}`).value);
  const years = Number(defaultMarketSettings(market).horizon_years) || 10;
  if (!Number.isFinite(requiredReturnPct) || requiredReturnPct <= -100) {
    hint.textContent = '할인계수 계산 불가';
    return;
  }
  const rate = 1 + requiredReturnPct / 100;
  const factor = 1 / Math.pow(rate, years);
  hint.textContent = `1 / ${rate.toFixed(2)}^${years} = ${factor.toFixed(3)}배`;
}

function fmtPrice(value, currency) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (currency === 'KRW') return `${Math.round(n).toLocaleString('ko-KR')}원`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
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
    asset.latest_net_income,
    common.requiredReturnPct,
    common.terminalPe,
    common.horizonYears,
  );
}

function resolveMarketCagr(asset, common, overrides = marketCagrOverrides) {
  if (!(Number(asset.latest_net_income) > 0)) return null;
  const saved = Object.prototype.hasOwnProperty.call(overrides, asset.ticker)
    ? overrides[asset.ticker] : null;
  return isValidCagrPct(saved) ? Number(saved) : impliedForAsset(asset, common);
}

function calculateAsset(asset, growthPct, common) {
  return calculatePegr(
    asset.price,
    asset.shares,
    asset.latest_net_income,
    growthPct,
    common.requiredReturnPct,
    common.terminalPe,
    common.horizonYears,
  );
}

function updateRowValuation(row, calc, currency) {
  const field = name => row.querySelector(`[data-field="${name}"]`);
  field('fair-market-cap').textContent = calc ? fmtCompactMoney(calc.fairMarketCap, currency) : '—';
  field('pegr').innerHTML = pegrHtml(calc?.pegr);
  field('gap').innerHTML = gapHtml(calc?.pegr);
  field('fair-price').textContent = calc ? fmtPrice(calc.fairPrice, currency) : '—';
  field('earnings-10').textContent = calc ? fmtCompactMoney(calc.earnings10, currency) : '—';
}

function renderMarket(market) {
  if (!rawData) return;
  const body = document.getElementById(`${market.toLowerCase()}-body`);
  const common = commonInputs(market);
  body.innerHTML = '';

  rawData.assets.filter(asset => asset.market === market).forEach(asset => {
    const canValue = Number(asset.latest_net_income) > 0;
    const hasOverride = canValue
      && Object.prototype.hasOwnProperty.call(marketCagrOverrides, asset.ticker);
    const growthPct = resolveMarketCagr(asset, common);
    const calc = calculateAsset(asset, growthPct, common);
    const incomeYear = String(asset.latest_net_income_date || '').slice(0, 4);
    const incomeTitle = asset.latest_net_income_date
      ? `${asset.latest_net_income_date} 실제 연간 지배주주순이익`
      : '최신 실제 연간 지배주주순이익';
    const row = document.createElement('tr');
    row.dataset.ticker = asset.ticker;
    row.innerHTML = `
      <td><div class="name">${asset.name}</div><div class="ticker">${asset.ticker}</div></td>
      <td class="metric-cell marketcap-cell">${fmtCompactMoney(asset.market_cap, asset.currency)}</td>
      <td class="metric-cell market-eval-cell">
        <span class="market-cagr-editor">
          <input class="market-cagr-input" type="number" step="0.01"
            value="${isValidCagrPct(growthPct) ? Number(growthPct).toFixed(2) : ''}"
            aria-label="${asset.name} 시장 내재 순이익 CAGR"
            title="최신 실제 연간 순이익에 적용하는 10년 총순이익 CAGR"
            ${canValue ? '' : 'disabled'}>
          <span class="unit">%</span>
          <button class="market-cagr-reset" type="button"
            aria-label="${asset.name} 시장 평가 초기화"
            title="${asset.name} 시장 평가 초기화"
            ${hasOverride && canValue ? '' : 'disabled'}>↺</button>
        </span>
      </td>
      <td class="metric-cell fair-marketcap-cell" data-field="fair-market-cap">${calc ? fmtCompactMoney(calc.fairMarketCap, asset.currency) : '—'}</td>
      <td data-field="pegr">${pegrHtml(calc?.pegr)}</td>
      <td data-field="gap">${gapHtml(calc?.pegr)}</td>
      <td>${fmtPrice(asset.price, asset.currency)}</td>
      <td data-field="fair-price">${calc ? fmtPrice(calc.fairPrice, asset.currency) : '—'}</td>
      <td class="metric-cell earnings-cell" title="${incomeTitle}">
        <div>${fmtCompactMoney(asset.latest_net_income, asset.currency)}</div>
        <div class="earnings-period">${incomeYear || '—'}</div>
      </td>
      <td class="metric-cell earnings-cell" data-field="earnings-10">${calc ? fmtCompactMoney(calc.earnings10, asset.currency) : '—'}</td>
      <td class="metric-cell shares-cell">${fmtShares(asset.shares)}</td>
    `;

    const input = row.querySelector('.market-cagr-input');
    const reset = row.querySelector('.market-cagr-reset');
    const restoreImplied = () => {
      marketCagrOverrides = removeMarketCagrOverride(marketCagrOverrides, asset.ticker);
      const currentCommon = commonInputs(market);
      const implied = resolveMarketCagr(asset, currentCommon);
      input.value = isValidCagrPct(implied) ? Number(implied).toFixed(2) : '';
      reset.disabled = true;
      updateRowValuation(row, calculateAsset(asset, implied, currentCommon), asset.currency);
    };

    input.addEventListener('input', () => {
      const value = input.value.trim() === '' ? null : Number(input.value);
      let editedCalc = null;
      if (isValidCagrPct(value)) {
        marketCagrOverrides[asset.ticker] = value;
        reset.disabled = false;
        editedCalc = calculateAsset(asset, value, commonInputs(market));
      } else {
        marketCagrOverrides = removeMarketCagrOverride(marketCagrOverrides, asset.ticker);
        reset.disabled = true;
      }
      updateRowValuation(row, editedCalc, asset.currency);
      markDirty(market, false);
    });
    input.addEventListener('change', () => {
      if (!isValidCagrPct(input.value.trim())) restoreImplied();
    });
    reset.addEventListener('click', () => {
      restoreImplied();
      markDirty(market, false);
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
    rawData = await fetch('pegr_data.json?v=pegr-v03-20260805').then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    document.getElementById('updated').textContent = rawData.updated;
    const settings = loadSettings();
    marketCagrOverrides = normalizeMarketCagrOverrides(settings.market_cagr_overrides);

    Object.keys(rawData.market_settings).forEach(market => {
      const key = market.toLowerCase();
      const defaults = defaultMarketSettings(market);
      const saved = settings.market_settings?.[market] || {};
      const savedRequired = Number(saved.required_return_pct);
      const savedTerminalPe = Number(saved.terminal_pe);
      document.getElementById(`req-${key}`).value = Number.isFinite(savedRequired) && savedRequired > -100
        ? savedRequired : Number(defaults.required_return) * 100;
      document.getElementById(`terminal-pe-${key}`).value = Number.isFinite(savedTerminalPe) && savedTerminalPe > 0
        ? savedTerminalPe : Number(defaults.terminal_pe);
      updateRequiredReturnHint(market);
      document.getElementById(`req-${key}`).addEventListener('input', () => markDirty(market, true));
      document.getElementById(`terminal-pe-${key}`).addEventListener('input', () => markDirty(market, true));
    });
    renderAllMarkets();
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
    fmtPrice,
    fmtCompactMoney,
  };
}
if (typeof document !== 'undefined') init();
