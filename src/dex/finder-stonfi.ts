import { Address, TonClient } from "@ton/ton";
import { getJettonInfo } from "../utils";
import { PoolFinder, Dex, PoolInfo } from "./finder";

export class StonfiPoolFinder extends PoolFinder {
    public static create(client: TonClient): StonfiPoolFinder {
        return new StonfiPoolFinder(client);
    }

    public async findPools(master: Address): Promise<PoolInfo[]> {
        const routers = await StonfiPoolFinder.fetchRouters();
        const pools = await StonfiPoolFinder.fetchPools(master);
        const jettonData = await getJettonInfo(this.client, master);
        return pools.map(pool => {
            const version = routers.find(router => router.address.equals(pool.router));
            if (!version)
                throw new Error("Cannot find router for pool");
            const versionString = `${version.major}${(version.minor !== 0 ? `.${version.minor}` : "")}`
            return {
                dex: version.major === 1 ? Dex.STONFI_V1 : Dex.STONFI_V2,
                name: `STON.FI V${versionString} TON/${jettonData.symbol}`,
                address: pool.address,
                reservesUsd: pool.reservesUsd
            } as PoolInfo
        });
    }

    private static async fetchPools(master: Address): Promise<{
        address: Address,
        router: Address,
        reservesUsd: number
    }[]> {
        const request = `https://api.ston.fi/v1/pool/query?unconditional_asset=${master.toString()}&dex_v2=true`;
        const response = await fetch(request, { method: "POST" });
        const json = (await response.json()) as any;
        const pools = json["pool_list"] as any[];
        return pools.map(x => ({
            address: Address.parse(x["address"]),
            router: Address.parse(x["router_address"]),
            reservesUsd: Number.parseFloat(x["lp_total_supply_usd"])
        }));
    }

    private static async fetchRouters(): Promise<{
        address: Address, 
        major: number, 
        minor: number
    }[]> {
        const request = `https://api.ston.fi/v1/routers?dex_v2=true`;
        const response = await fetch(request);
        const json = (await response.json()) as any;
        const routers = json["router_list"] as any[];
        return routers.map(router => ({
            address: Address.parse(router["address"]),
            major: router["major_version"],
            minor: router["minor_version"]
        }));
    }
}