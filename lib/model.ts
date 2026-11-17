// lib/model.ts — the token launch radar's value model (radar-2).
//
// The radar reads a sealed DefiLlama snapshot and answers one question: which
// protocol that records no token yet would its launch be worth, and what does a
// reader do about it. The model is the entry's own claim, built only from the
// snapshot's own figures: a protocol's TVL, its seven-day growth, and how long
// it has run with no token. Nothing here names a protocol by hand.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelDetail {
  multiple: number;
  multiple_n: number;
  category_median: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number;
  implied_value_usd: number;
  model: ModelDetail;
  farm_steps: string[];
}

export interface LiveEntry {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  age_days: number;
}

export interface RadarResult {
  rows: RadarRow[];
  live: LiveEntry[];
  watchlistTotal: number;
  watchlistCovered: number;
  belowFloorRows: number;
  topTenTotal: number;
}

// ---------------------------------------------------------------- screening

const BARRED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const VERSION_SUFFIX = /\s(v?\d+\.\d+|v\d+)$/i;
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when the snapshot records no token for the protocol at all. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the name marks the protocol as a wrapped, staked or versioned product. */
export function looksLikeDerivative(p: SnapshotProtocol): boolean {
  return VERSION_SUFFIX.test(p.name) || DERIVATIVE_WORD.test(p.name) || EXCHANGE_PREFIXES.test(p.name);
}

/** True when the protocol may be ranked: no token on record, not a derivative product, not a barred category. */
export function canRank(p: SnapshotProtocol): boolean {
  if (!hasNoToken(p)) return false;
  if (looksLikeDerivative(p)) return false;
  if (p.category !== null && BARRED_CATEGORIES.has(p.category)) return false;
  return true;
}

// ---------------------------------------------------------------- helpers

export function clamp(v: number, low: number, high: number): number {
  return v < low ? low : v > high ? high : v;
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Days between the snapshot's date and the day DefiLlama began tracking the protocol; 365 when unlisted. */
export function ageInDays(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 365;
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(listed) || Number.isNaN(asOfMs)) return 365;
  return Math.max(0, Math.floor((asOfMs - listed) / 86400000));
}

export function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}k`;
  return `$${Math.round(value)}`;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------- multiples

export interface Multiples {
  byCategory: Map<string, number>;
  global: number;
  liveCounts: Map<string, number>;
  /** The raw median ratio per category, before shrinkage; and the raw global median. */
  rawMedian: Map<string, number>;
  globalRaw: number;
}

/**
 * The market's own price for each kind of protocol: the median market-cap to
 * TVL ratio of the live-token protocols in the same category, shrunk toward the
 * global median with a prior of 3, then clamped to [0.05, 1.50]. A category
 * with no live protocol takes the global median. liveCounts records how many
 * live-token protocols back each category's median, for the detail view.
 */
export function categoryMultiples(protocols: SnapshotProtocol[]): Multiples {
  const ratiosByCategory = new Map<string, number[]>();
  const liveCounts = new Map<string, number>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
    liveCounts.set(key, (liveCounts.get(key) ?? 0) + 1);
  }
  const globalRaw = medianOf(allRatios);
  const global = clamp(globalRaw, 0.05, 1.5);
  const byCategory = new Map<string, number>();
  const rawMedian = new Map<string, number>();
  for (const [category, ratios] of ratiosByCategory) {
    const catMedian = medianOf(ratios);
    rawMedian.set(category, catMedian);
    const shrunk = (ratios.length * catMedian + 3 * global) / (ratios.length + 3);
    byCategory.set(category, clamp(shrunk, 0.05, 1.5));
  }
  return { byCategory, global, liveCounts, rawMedian, globalRaw };
}

// ---------------------------------------------------------------- scoring

export interface Scored {
  implied: number;
  detail: ModelDetail;
}

export function scoreOne(p: SnapshotProtocol, multiples: Multiples, asOf: string): Scored {
  const key = p.category ?? 'Uncategorised';
  const multiple = multiples.byCategory.get(key) ?? multiples.global;
  const multipleN = multiples.liveCounts.get(key) ?? 0;
  const growthPct = p.change_7d ?? 0;
  const growth = 1 + (clamp(growthPct, -60, 120) / 100) * 0.5;
  const age = ageInDays(p.listed_at, asOf);
  const maturity = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
  const implied = Math.round(p.tvl_usd * multiple * growth * maturity);
  return {
    implied,
    detail: {
      multiple: round4(multiple),
      multiple_n: multipleN,
      category_median: round4(multiples.rawMedian.get(key) ?? multiples.globalRaw),
      growth_pct: round4(growthPct),
      growth_multiplier: round4(growth),
      maturity_multiplier: round4(maturity),
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------- farm plans

function familyOf(category: string): string {
  const c = category.toLowerCase();
  if (c.includes('lending')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('yield')) return 'yield';
  if (c.includes('risk')) return 'curator';
  if (c.includes('rwa') || c.includes('real world')) return 'rwa';
  if (c.includes('deriv')) return 'derivatives';
  if (c.includes('cdp') || c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  return 'generic';
}

function familySteps(family: string): [string, string] {
  switch (family) {
    case 'lending':
      return [
        'Supply a stablecoin or blue-chip asset to the lending market and confirm the deposit shows in your position. Cost: $1-$5 in gas. Time: about 15 minutes.',
        'Borrow a small amount against the supply to keep the position active, and keep the health factor above 2 so a price swing cannot liquidate it. Cost: $1-$5 in gas plus borrow interest. Time: about 20 minutes.',
      ];
    case 'dex':
      return [
        'Add liquidity to the protocol\'s deepest pool in equal value of both assets and confirm the LP receipt in your wallet. Cost: $1-$8 in gas and swap fees. Time: about 20 minutes.',
        'Route a small swap through the pool to confirm pricing and depth, then leave the liquidity working and check its fees weekly. Cost: $1-$5 in swap fees. Time: about 15 minutes.',
      ];
    case 'yield':
      return [
        'Deposit into the protocol\'s main vault and confirm the vault token lands in your wallet. Cost: $1-$6 in gas. Time: about 15 minutes.',
        'Read the vault\'s strategy page so you know what it farms, then check the yield weekly and harvest only when the gas is worth it. Cost: $1-$10 to harvest. Time: about 10 minutes a week.',
      ];
    case 'curator':
      return [
        'Pick a curator vault whose allocation you understand, deposit, and confirm the vault token in your wallet. Cost: $1-$6 in gas. Time: about 20 minutes.',
        'Read the curator\'s allocation report and set a calendar reminder to review it monthly, since curators can move funds between markets. Cost: $0. Time: 15 minutes a month.',
      ];
    case 'rwa':
      return [
        'Check the protocol\'s eligibility rules and finish any identity check it requires before depositing anything. Cost: $0-$10 for verification. Time: about 30 minutes.',
        'Mint the tokenised asset with the minimum amount first, confirm it in your wallet, then add the rest once the first mint clears. Cost: $2-$10 in gas and mint fees. Time: about 25 minutes.',
      ];
    case 'derivatives':
      return [
        'Open a small test position on the protocol\'s main market and confirm the margin and liquidation price shown. Cost: $1-$8 in gas and trading fees. Time: about 20 minutes.',
        'Set a stop or an alert at a level you accept, and never let one position risk more than a small share of the wallet. Cost: $0. Time: 10 minutes.',
      ];
    case 'stable':
      return [
        'Mint the stable asset against collateral at a conservative ratio and confirm the debt and collateral in your position. Cost: $1-$6 in gas. Time: about 20 minutes.',
        'Watch the collateral ratio weekly and top it up before it nears the liquidation line. Cost: $1-$5 in gas per top-up. Time: 10 minutes a week.',
      ];
    case 'insurance':
      return [
        'Buy cover for the protocol or asset you already use, for the smallest term the app offers, and confirm the policy in your wallet. Cost: the cover premium plus $1-$5 in gas. Time: about 20 minutes.',
        'Note the cover\'s expiry and claim window in your calendar so a claim is never filed late. Cost: $0. Time: 5 minutes.',
      ];
    default:
      return [
        'Open the protocol\'s app, connect the fresh wallet, and use its main feature once with the minimum amount to confirm it works. Cost: $1-$8 in gas and fees. Time: about 20 minutes.',
        'Leave the position working and check the protocol\'s announcements weekly for a points or rewards program. Cost: $0. Time: 10 minutes a week.',
      ];
  }
}

function sizeStep(p: SnapshotProtocol): string {
  const tvl = formatUsd(p.tvl_usd);
  const age = ageInDays(p.listed_at, '2026-11-14');
  const ageNote =
    age < 180
      ? `It has only been tracked for ${age} days, so it is early: expect the app and the rewards to change.`
      : `It has run for ${(age / 365).toFixed(1)} years with no token on record, so read its docs for a points program before sizing up.`;
  if (p.tvl_usd >= 1e9) {
    return `With ${tvl} of value already locked, size the position as a modest share of your farm wallet and add more only after a week of clean operation. ${ageNote} Cost: $0. Time: 10 minutes.`;
  }
  if (p.tvl_usd >= 1e8) {
    return `At ${tvl} of TVL the protocol is established; a medium position fits, split across two deposits a week apart. ${ageNote} Cost: $1-$5 in extra gas. Time: about 15 minutes.`;
  }
  return `The protocol is still small at ${tvl} of TVL, so keep the position small and treat it as an early bet that can go to zero. ${ageNote} Cost: $0. Time: 10 minutes.`;
}

/** Six concrete steps for farming one protocol, each with what it costs and how long it takes. */
export function farmPlan(p: SnapshotProtocol): string[] {
  const mainChain = p.chains[0] ?? 'its home chain';
  const [first, second] = familySteps(familyOf(p.category ?? ''));
  return [
    `Open a fresh wallet just for ${p.name} and write its seed phrase down on paper, offline — never paste it into a site, a chat or a form. Cost: $0. Time: 10 minutes.`,
    `Move funds to ${mainChain} with the official bridge and keep enough of the chain's gas token aside for fees before you interact. Cost: $2-$20 in bridge and gas fees. Time: about 20 minutes.`,
    first,
    second,
    sizeStep(p),
    'Write down every deposit, its date and its cost, and check the protocol\'s points or rewards page weekly so nothing expires unclaimed. Cost: $0. Time: 15 minutes a week.',
  ];
}

// ---------------------------------------------------------------- the board

export function buildRadar(snapshot: Snapshot): RadarResult {
  const multiples = categoryMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

  const scored: { p: SnapshotProtocol; implied: number; detail: ModelDetail }[] = [];
  for (const p of snapshot.protocols) {
    if (!canRank(p)) continue;
    if (!watchlist.has(p.slug) && p.tvl_usd >= snapshot.floor_usd) continue;
    const { implied, detail } = scoreOne(p, multiples, snapshot.as_of);
    scored.push({ p, implied, detail });
  }
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

  // Ties are broken by one-dollar steps so the ranking is strict: rank 1 is the
  // board's most valuable protocol and no two rows share a value.
  let previous = Number.POSITIVE_INFINITY;
  const rows: RadarRow[] = scored.map((entry, index) => {
    let value = entry.implied;
    if (value >= previous) value = previous - 1;
    previous = value;
    const p = entry.p;
    return {
      rank: index + 1,
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: entry.detail.age_days,
      implied_value_usd: value,
      model: entry.detail,
      farm_steps: farmPlan(p),
    };
  });

  const live: LiveEntry[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd as number,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      age_days: ageInDays(p.listed_at, snapshot.as_of),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);

  const watchlistCovered = rows.filter((r) => watchlist.has(r.slug)).length;
  const belowFloorRows = rows.filter((r) => {
    const p = bySlug.get(r.slug);
    return p !== undefined && !watchlist.has(r.slug);
  }).length;
  const topTenTotal = rows.slice(0, 10).reduce((sum, r) => sum + r.implied_value_usd, 0);

  return {
    rows,
    live,
    watchlistTotal: snapshot.watchlist.length,
    watchlistCovered,
    belowFloorRows,
    topTenTotal,
  };
}

/** The gate's own checks over a built board; an empty list means it passes. */
export function checkRadar(result: RadarResult, snapshot: Snapshot): string[] {
  const problems: string[] = [];
  const { rows } = result;
  if (rows.length < 100) problems.push(`board holds ${rows.length} rows, fewer than the 100 required`);
  const seen = new Set<string>();
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of rows) {
    if (seen.has(r.slug)) problems.push(`slug ${r.slug} appears twice`);
    seen.add(r.slug);
    if (!snapshotSlugs.has(r.slug)) problems.push(`slug ${r.slug} is not in the snapshot`);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) problems.push(`watchlist protocol ${slug} is missing from the board`);
  }
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) problems.push(`row ${r.slug} has rank ${r.rank}, expected ${i + 1}`);
  });
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd >= rows[i - 1]!.implied_value_usd) {
      problems.push(`implied value rises at rank ${rows[i]!.rank}`);
      break;
    }
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size !== rows.length) {
    problems.push('implied values are not all distinct');
  }
  for (const r of rows) {
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      problems.push(`row ${r.slug} has an invalid implied value ${r.implied_value_usd}`);
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      problems.push(`row ${r.slug} has ${r.farm_steps.length} farm steps, outside 3-12`);
    }
    for (const step of r.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        problems.push(`row ${r.slug} has a farm step of ${trimmed.length} characters, outside 20-600`);
      }
    }
  }
  return problems;
}
