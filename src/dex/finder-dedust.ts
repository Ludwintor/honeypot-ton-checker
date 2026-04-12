import { Address, TonClient } from "@ton/ton";
import { Dex, PoolFinder, PoolInfo } from "./finder";

const dexToInternal = {
  "dedust": Dex.DEDUST,
  "dedust_v3_cpmm": Dex.DEDUST_V2
} as const

export class DedustPoolFinder extends PoolFinder {
  public static create(client: TonClient): DedustPoolFinder {
    return new DedustPoolFinder(client);
  }

  public async findPools(master: Address): Promise<PoolInfo[]> {
    const request = "https://mainnet.api.dedust.io/v4/api/get_pair_pools"
    const response = await fetch(request, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        assets: ["native", master.toString()],
        limit: 10,
        offset: 0,
        sort_by: "tvl",
        sort_direction: "desc"
      })
    })
    const json = (await response.json()) as any
    const assetsMeta = json["assets_metadata"] as any
    const jettonTicker = assetsMeta[`jetton:${master.toRawString()}`]["ticker"]
    const pools = json["pools"] as any[]
    return pools
      .filter(x => x["dex"] in dexToInternal)
      .map(x => ({
        dex: dexToInternal[x["dex"] as keyof typeof dexToInternal],
        name: `DEDUST TON/${jettonTicker ?? master.toString()}`,
        address: Address.parseRaw(x["address"]),
        reservesUsd: Number.parseFloat(x["tvl_usd"])
      }) as PoolInfo)
  }
}
