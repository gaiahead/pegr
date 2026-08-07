const assert = require('node:assert/strict');
const {
  calculatePer,
  calculatePegr,
  impliedEpsCagr,
  normalizeEpsCagrOverrides,
  removeEpsCagrOverride,
  fmtPrice,
  fmtCompactMoney,
} = require('./app.js');

const per = calculatePer(25, 200, 250);
assert.ok(per);
assert.equal(per.marketCap, 5000);
assert.equal(per.latestEps, 1.25);
assert.equal(per.currentPer, 20);

for (const [currentPer, growth, expected] of [
  [15, 15, 1],
  [20, 10, 2],
  [10, 20, 0.5],
]) {
  const calc = calculatePegr(currentPer, 100, 100, growth);
  assert.ok(calc);
  assert.ok(Math.abs(calc.currentPer - currentPer) < 1e-12);
  assert.ok(Math.abs(calc.pegr - expected) < 1e-12);
}

const implied = impliedEpsCagr(25, 200, 250);
assert.equal(implied, 20);
const neutral = calculatePegr(25, 200, 250, implied);
assert.ok(neutral);
assert.ok(Math.abs(neutral.pegr - 1) < 1e-12);

assert.equal(calculatePer(10, 100, 0), null);
assert.equal(calculatePegr(10, 100, 100, 0), null);
assert.equal(calculatePegr(10, 100, 100, -5), null);
assert.equal(impliedEpsCagr(10, 100, -1), null);

const overrides = normalizeEpsCagrOverrides({
  AAPL: '12.5',
  '005930': '11.2',
  invalid: 'nope',
  zero: 0,
  negative: -1,
});
assert.deepEqual(overrides, { AAPL: 12.5, '005930': 11.2 });
assert.deepEqual(
  removeEpsCagrOverride({ AAPL: 12.5, MSFT: 11 }, 'AAPL'),
  { MSFT: 11 },
);

assert.equal(fmtPrice(247000, 'KRW'), '247,000원');
assert.equal(fmtCompactMoney(1_640_000_000_000_000, 'KRW'), '1640.00조');
assert.equal(fmtPrice(303.42, 'USD'), '$303.42');

console.log(JSON.stringify({ per, implied, neutral }, null, 2));
