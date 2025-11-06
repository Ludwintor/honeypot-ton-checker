# honeypot-ton-checker

Simple TON blockchain honeypot detector with liquidity simulation using [@ton/sandbox](https://github.com/ton-org/sandbox)
All simulations are run on the client-side but still uses network to fetch contract states from mainnet and some liquidity pools info

## Quick start

```
pnpm i
pnpm run build
pnpm run preview
```
Go to http://localhost:4173

## Features & Limitations
- [x] [Dedust](https://dedust.io/) and [Ston.fi](https://app.ston.fi/) (V1 and V2) pools supported
- [x] Only TON/JETTON pairs supported
- [x] Simulates buy, transfer and sell operations
- [x] Detects fees on operations with jetton
- [ ] Optimize simulation performance
- [ ] Add support for JETTON/JETTON pairs
- [ ] Provide more info about simulated pool

## Buy me a coffee

### TON
```
UQA705AUWErQe9Ur56CZz-v6N9J2uw298w-31ZCu475hT8U4
```

### Tron
```
TEHvFyCMSQSGsKg1TVGCcCiDXr1DMs4MTe
```

### ETH, BSC
```
0x95Ba8e4FeC184Ef983a89B020E6399Fa01E53bA3
```

### BTC
```
bc1q9czr3qmypd6xvt7m5c8lnnfh4e5ra6ppkjp78s
```
