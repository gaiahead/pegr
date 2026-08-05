const assert = require('node:assert/strict');
const {
  fairMarketCap,
  calculatePegr,
  impliedEarningsCagr,
  normalizeMarketCagrOverrides,
  removeMarketCagrOverride,
  fmtPrice,
  fmtCompactMoney,
} = require('./app.js');

const fixture = {
  price: 100,
  shares: 1_000_000_000,
  latestNetIncome: 10_000_000_000,
  requiredReturnPct: 10,
  terminalPe: 15,
  horizonYears: 10,
};

const valuation = fairMarketCap(
  fixture.latestNetIncome, 8, fixture.requiredReturnPct,
  fixture.terminalPe, fixture.horizonYears,
);
const expectedEarnings = fixture.latestNetIncome * Math.pow(1.08, fixture.horizonYears);
const expectedValue = expectedEarnings * fixture.terminalPe
  / Math.pow(1 + fixture.requiredReturnPct / 100, fixture.horizonYears);
assert.ok(Math.abs(valuation.earnings10 - expectedEarnings) < 1e-4);
assert.ok(Math.abs(valuation.fairMarketCap - expectedValue) < 1e-4);
assert.equal(valuation.fairMarketCap, valuation.terminalPv);
assert.equal(Object.hasOwn(valuation, 'payoutPv'), false);

const implied = impliedEarningsCagr(
  fixture.price, fixture.shares, fixture.latestNetIncome,
  fixture.requiredReturnPct, fixture.terminalPe, fixture.horizonYears,
);
assert.ok(Number.isFinite(implied));
const repriced = calculatePegr(
  fixture.price, fixture.shares, fixture.latestNetIncome,
  implied, fixture.requiredReturnPct, fixture.terminalPe, fixture.horizonYears,
);
assert.ok(repriced);
assert.ok(Math.abs(repriced.pegr - 1) < 1e-9);
assert.ok(Math.abs(repriced.fairPrice - fixture.price) < 1e-7);
assert.equal(calculatePegr(
  fixture.price, fixture.shares, -1,
  5, fixture.requiredReturnPct, fixture.terminalPe, fixture.horizonYears,
), null);

const overrides = normalizeMarketCagrOverrides({
  AAPL: '12.5',
  '005930': '11.2',
  MSFT: -99.9,
  invalid: 'nope',
  impossible: -100,
});
assert.deepEqual(overrides, { AAPL: 12.5, '005930': 11.2, MSFT: -99.9 });
assert.deepEqual(
  removeMarketCagrOverride({ AAPL: 12.5, MSFT: 11 }, 'AAPL'),
  { MSFT: 11 },
);

assert.equal(fmtPrice(247000, 'KRW'), '247,000원');
assert.equal(fmtCompactMoney(1_640_000_000_000_000, 'KRW'), '1640.00조');
assert.equal(fmtPrice(303.42, 'USD'), '$303.42');

console.log(JSON.stringify({ implied, repriced, terminalPv: valuation.terminalPv }, null, 2));
