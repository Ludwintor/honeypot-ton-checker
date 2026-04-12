import { Address, beginCell, toNano, Transaction } from "@ton/core";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton/sandbox";
import { addLibs, createJettonTransferBody, getJettonBalance } from "./simulation-utils";
import { Simulation, StageSimulationInfo } from "./simulation";
import { libs } from "./dedustV2-libs";

const FEE_BASE = 10000n
const FORWARD_FEE = toNano(0.25)

const enum FeeIn {
  BOTH,
  X,
  Y
}

export class DedustV2Simulation extends Simulation {
  private readonly amountIn: bigint;
  private readonly assetIn: Address | null;
  private readonly pool: Address;
  private readonly feeIn: FeeIn

  private constructor(chain: Blockchain, master: Address, amountIn: bigint, assetIn: Address | null, pool: Address, feeIn: FeeIn) {
    super(chain, master);
    this.amountIn = amountIn;
    this.assetIn = assetIn;
    this.pool = pool;
    this.feeIn = feeIn
  }

  public static async create(chain: Blockchain, master: Address, pool: Address, amountIn: bigint) {
    addLibs(chain, libs)
    const assetIn = null // TON
    const poolAccount = (await chain.getContract(pool)).account.account
    if (poolAccount?.storage.state.type !== "active" || !poolAccount.storage.state.state.data)
      throw new Error("pool is not ready")
    const data = poolAccount.storage.state.state.data.beginParse()
    const config = data.loadRef().beginParse()
    config.loadMaybeAddress() // skip assetX
    config.loadMaybeAddress() // skip assetY
    config.loadMaybeAddress() // skip creatorAddress
    config.skip(16 + 16 + 1 + 1) // skip baseFeeBps + creatorFeeBps + maybe depositActivation + maybe swapActivation
    const feeIn = config.loadUint(2)
    return new DedustV2Simulation(chain, master, amountIn, assetIn, pool, feeIn);
  }

  protected async simulateBuy(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
    : Promise<StageSimulationInfo | null> {
    const estimate = await this.getEstimateOutput(this.assetIn, this.amountIn);
    const result = await this.sendNativeSwap(treasury, this.amountIn)
    const actualBalance = await getJettonBalance(this.chain, jettonWallet);
    return {
      transactions: result.transactions,
      actualAmount: actualBalance,
      expectedAmount: estimate
    }
  }

  protected async simulateSell(treasury: SandboxContract<TreasuryContract>, jettonWallet: Address)
    : Promise<StageSimulationInfo | null> {
    const balance = await getJettonBalance(this.chain, jettonWallet);
    const estimate = await this.getEstimateOutput(this.master, balance)
    const result = await this.sendJettonSwap(treasury, jettonWallet, balance)
    const actualPayout = DedustV2Simulation.getActualPayout(result.transactions, this.pool);
    return {
      transactions: result.transactions,
      actualAmount: actualPayout,
      expectedAmount: estimate
    }
  }

  private async getEstimateOutput(assetIn: Address | null, amountIn: bigint) {
    const data = await this.chain.runGetMethod(this.pool, "get_pool_data")
    const reader = data.stackReader
    reader.skip(3) // status + depositActive + swapActive
    const assetX = reader.readAddressOpt()
    const assetY = reader.readAddressOpt()
    reader.skip(3) // walletsByAssets + assetsByWallets + resolutions
    const fee = reader.readBigNumber()
    const reserveX = reader.readBigNumber()
    const reserveY = reader.readBigNumber()

    let out = 0n
    if (assetIn ? assetX?.equals(assetIn) : assetX === null) {
      const outFee = this.feeIn === FeeIn.BOTH ? false : this.feeIn === FeeIn.Y
      out = DedustV2Simulation.getConstantProductOut(amountIn, reserveX, reserveY, fee, outFee)
    }
    else if (assetIn ? assetY?.equals(assetIn) : assetY === null) {
      const outFee = this.feeIn === FeeIn.BOTH ? false : this.feeIn === FeeIn.X
      out = DedustV2Simulation.getConstantProductOut(amountIn, reserveY, reserveX, fee, outFee)
    }
    return out
  }

  private static getConstantProductOut(amount: bigint, reserveIn: bigint, reserveOut: bigint, fee: bigint, outFee: boolean): bigint {
    if (!outFee)
      amount = amount * FEE_BASE / (FEE_BASE + fee)
    let out = amount * reserveOut / (reserveIn + amount)
    if (outFee)
      out = out * FEE_BASE / (FEE_BASE + fee)
    return out
  }

  private sendNativeSwap(sender: SandboxContract<TreasuryContract>, amount: bigint) {
    // pay_native#a5a7cbf8 query_id:uint64 amount:Coins
    //                     payment_payload:^Cell payout_config:^ExtendedPayoutConfig = IncomingMessage;
    const body = beginCell()
      .storeUint(0xa5a7cbf8, 32)
      .storeUint(0, 64)
      .storeCoins(amount)
      .storeRef(DedustV2Simulation.buildSwapPayload(0n, 600))
      .storeRef(DedustV2Simulation.buildPayoutConfig(sender.address))
      .endCell()
    return sender.send({
      to: this.pool,
      value: amount + toNano(1),
      body: body
    })
  }

  private sendJettonSwap(sender: SandboxContract<TreasuryContract>, jettonWallet: Address, amount: bigint) {
    // pay_jetton#cbc33949 payment_payload:^Cell payout_config:^ExtendedPayoutConfig = ForwardPayload;
    const payload = beginCell()
      .storeUint(0xcbc33949, 32)
      .storeRef(DedustV2Simulation.buildSwapPayload(0n, 600))
      .storeRef(DedustV2Simulation.buildPayoutConfig(sender.address))
      .endCell()
    const body = createJettonTransferBody({
      amount: amount,
      destination: this.pool,
      response: sender.address,
      forwardAmount: FORWARD_FEE,
      payload: payload,
    })
    return sender.send({
      to: jettonWallet,
      value: toNano(0.06) + FORWARD_FEE,
      body: body
    })
  }

  private static buildSwapPayload(minAmountOut: bigint, expireIn: number) {
    // swap#c442500f minimal_amount_out:Coins deadline:uint40
    //               next:(Maybe ^SwapStep)
    //               partner_config:(Maybe PartnerConfig)
    //               referrer_config:(Maybe ReferrerConfig) = PaymentPayload;
    return beginCell()
      .storeUint(0xc442500f, 32)
      .storeCoins(minAmountOut)
      .storeUint(Math.floor(Date.now() / 1000) + expireIn, 40)
      .storeMaybeRef(null)
      .storeMaybeSlice(null)
      .storeMaybeSlice(null)
      .endCell()
  }

  private static buildPayoutConfig(sender: Address) {
    // _#_ fulfill:PayoutOptions reject:PayoutOptions excesses_to:MsgAddress = ExtendedPayoutConfig;
    // _#_ destination:MsgAddress extra_gas:Coins payload:(Maybe ^Cell) wrap_payload:Bool = PayoutOptions;
    return beginCell()
      .storeAddress(sender).storeCoins(0).storeMaybeRef(null).storeBit(false)
      .storeAddress(sender).storeCoins(0).storeMaybeRef(null).storeBit(false)
      .storeAddress(sender)
      .endCell()
  }

  private static getActualPayout(transactions: Transaction[], pool: Address): bigint {
    for (const tx of transactions) {
      if (tx.description.type !== "generic")
        continue;
      for (const child of tx.outMessages.values()) {
        if (child.info.type !== "external-out" || !child.info.src.equals(pool))
          continue;
        const body = child.body.beginParse();
        const op = body.loadUint(32);
        if (op !== 0x78e79ba4)
          continue;
        body.skip(1) // xToY
        body.loadCoins(); // amountIn
        return body.loadCoins() // amountOut
      }
    }
    return 0n;
  }
}
