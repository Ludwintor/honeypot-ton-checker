# honeypot-ton-checker

Simple TON blockchain honeypot detector with liquidity simulation using [@ton/sandbox](https://github.com/ton-org/sandbox)
All simulations are run on the client-side but still uses network to fetch contract states from mainnet and some liquidity pools info

## Quick start

```
npm i
npm run build
npm run preview
```
Go to http://localhost:4173

## Features & Limitations
- [x] [Dedust](https://dedust.io/) and [Ston.fi](https://app.ston.fi/) (only V1) pools supported
- [x] Only TON/JETTON pairs supported
- [x] Simulates buy, transfer and sell operations
- [x] Detects fees on operations with jetton
- [ ] Add support for [Ston.fi](https://app.ston.fi/) V2 pools
- [ ] Optimize simulation performance
- [ ] Add support for JETTON/JETTON pairs
- [ ] Provide more info about simulated pool