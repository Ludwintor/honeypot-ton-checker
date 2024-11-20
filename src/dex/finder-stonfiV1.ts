import { DEX } from "@ston-fi/sdk";
import { Address, TonClient } from "@ton/ton";
import { RouterV1 } from "../stonfi";
import { getJettonInfo } from "../utils";
import { PoolFinder, Dex, PoolInfo } from "./finder";

export class StonfiV1PoolFinder extends PoolFinder {
    public get dex(): Dex {
        return Dex.STONFI_V1;
    }

    public static create(client: TonClient): StonfiV1PoolFinder {
        return new StonfiV1PoolFinder(client);
    }

    public async findPool(master: Address): Promise<PoolInfo | null> {
        const router = this.client.open(new RouterV1());
        const pool = await router.getPool({
            token0: new DEX.v1.pTON().address,
            token1: master
        });
        const state = await this.client.getContractState(pool.address);
        if (state.state !== "active")
            return null;
        const jettonData = await getJettonInfo(this.client, master);
        const reserves = await StonfiV1PoolFinder.fetchReservesUsd(pool.address);
        return {
            dex: this.dex,
            pairName: `TON/${jettonData.symbol}`,
            address: pool.address,
            reservesUsd: reserves
        };
    }

    private static async fetchReservesUsd(pool: Address): Promise<number> {
        const request = `https://api.ston.fi/v1/pools/${pool.toString()}`;
        const response = await fetch(request);
        const json = (await response.json()) as any;
        return Number.parseFloat(json["pool"]["lp_total_supply_usd"]);
    }
}