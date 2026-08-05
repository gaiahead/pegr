const assert = require('node:assert/strict');
const {
  fairMarketCap,
  calculatePegr,
  impliedEarningsCagr,
  normalizeMarketCagrOverrides,
  removeMarketCagrOverride,
} = require('./app.js');

const fixture = {
  price: 100,
  shares: 1_000_000_000,
  normalizedIncome: 10_000_000_000,
  payoutRatioPct: 50,
  requiredReturnPct: 10,
  terminalPe: 15,
  horizonYears: 10,
};

const noPayout = fairMarketCap(
  fixture.normalizedIncome, 8, 0, fixture.requiredReturnPct,
  fixture.terminalPe, fixture.horizonYears,
);
const withPayout = fairMarketCap(
  fixture.normalizedIncome, 8, fixture.payoutRatioPct,
  fixture.requiredReturnPct, fixture.terminalPe, fixture.horizonYears,
);
assert.ok(withPayout.fairMarketCap > noPayout.fairMarketCap);
assert.ok(withPayout.payoutPv > 0);

const implied = impliedEarningsCagr(
  fixture.price, fixture.shares, fixture.normalizedIncome,
  fixture.payoutRatioPct, fixture.requiredReturnPct,
  fixture.terminalPe, fixture.horizonYears,
);
assert.ok(Number.isFinite(implied));
const repriced = calculatePegr(
  fixture.price, fixture.shares, fixture.normalizedIncome,
  fixture.payoutRatioPct, implied, fixture.requiredReturnPct,
  fixture.terminalPe, fixture.horizonYears,
);
assert.ok(repriced);
assert.ok(Math.abs(repriced.pegr - 1) < 1e-9);
assert.ok(Math.abs(repriced.fairPrice - fixture.price) < 1e-7);

const overrides = normalizeMarketCagrOverrides({
  AAPL: '12.5',
  MSFT: -99.9,
  invalid: 'nope',
  impossible: -100,
});
assert.deepEqual(overrides, { AAPL: 12.5, MSFT: -99.9 });
assert.deepEqual(
  removeMarketCagrOverride({ AAPL: 12.5, MSFT: 11 }, 'AAPL'),
  { MSFT: 11 },
);

console.log(JSON.stringify({ implied, repriced, payoutPv: withPayout.payoutPv }, null, 2));
