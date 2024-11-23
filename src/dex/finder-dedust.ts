import { Factory, MAINNET_FACTORY_ADDR, ReadinessStatus, Asset, PoolType } from "@dedust/sdk";
import { Address, TonClient } from "@ton/ton";
import { getJettonInfo } from "../utils";
import { Dex, PoolFinder, PoolInfo } from "./finder";

export class DedustPoolFinder extends PoolFinder {
    public static create(client: TonClient): DedustPoolFinder {
        return new DedustPoolFinder(client);
    }

    public async findPools(master: Address): Promise<PoolInfo[]> {
        const factory = this.client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
        const vaultJetton = this.client.open(await factory.getJettonVault(master));
        if (await vaultJetton.getReadinessStatus() !== ReadinessStatus.READY)
            return [];
        const assetNative = Asset.native();
        const assetJetton = Asset.jetton(master);
        const pool = this.client.open(await factory.getPool(PoolType.VOLATILE, [assetNative, assetJetton]));
        if (await pool.getReadinessStatus() !== ReadinessStatus.READY)
            return [];
        const jettonData = await getJettonInfo(this.client, master);
        const reserves = await DedustPoolFinder.fetchReservesUsd(pool.address);
        return [{
            dex: Dex.DEDUST,
            name: `DEDUST TON/${jettonData.symbol}`,
            address: pool.address,
            reservesUsd: reserves
        }];
    }

    private static async fetchReservesUsd(pool: Address): Promise<number> {
        const request =
            `https://api.geckoterminal.com/api/v2/search/pools?query=${pool.toString()}&network=ton&page=1`;
        const response = await fetch(request);
        const json = (await response.json()) as any;
        return Number.parseFloat(json["data"][0]["attributes"]["reserve_in_usd"]);
    }
}