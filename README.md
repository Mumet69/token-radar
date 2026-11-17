# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mumet69/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mumet69/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for the make.fun token-radar-01 bounty. It reads a sealed DefiLlama snapshot of every protocol, works out which ones still record no token and are not a wrapped or staked product of one that trades, and ranks them by what their launch would be worth — then hands in a web dashboard with the board, a detail view per protocol, and the steps to farm it.

## How the value is modelled (model `radar-2`)

```
implied = round( tvl_usd x category_multiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4) )
```

`category_multiple` is the market's own price for that kind of protocol: the median market-cap-to-TVL ratio of the live-token protocols in the same category, shrunk toward the global median (prior 3) and clamped to [0.05, 1.50]. A category with no live protocol uses the global median. Age is the time since the protocol was first listed; an unlisted age uses 365 days. Ties are broken by one-dollar steps so the ranking is strict.

The board holds every protocol on the snapshot's watchlist (40) plus every further rankable protocol below the $50M floor (138) — 178 rows. A protocol is rankable when the snapshot records no token for it and it is not a wrapped, staked or bridged product. The 20 further protocols above the floor that the house's own watchlist leaves out stay out, rather than guessing at a record the snapshot does not carry. Top of the board: Steakhouse Financial ($1.97B implied), Gauntlet ($1.17B), Nonce Capital ($272.4M); the top 10 together come to $4.49B. The 144 protocols whose token already trades are set aside in a Live token tab as comparables — their market-cap-to-TVL ratios are what the radar prices pre-token protocols against.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output directory, then `dossier.json` with the vendored `vendor/makefun-board.ts`. Running it twice writes the same bytes. The dashboard is a static page with no network requests: open `dashboard/index.html` from the output directory.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the data and the dossier
- `lib/model.ts` — the snapshot screen, the value model, the farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, copied unchanged from the kit
- `dashboard/` — the static page (index.html, app.css, app.js)
- `screenshots/` — the board, a protocol's detail view, and a filtered view

Implied values are this entry's estimates from the snapshot's figures, not predictions and not prices. A protocol is said to record no token when the snapshot carries no market cap, CoinGecko id or symbol for it.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
