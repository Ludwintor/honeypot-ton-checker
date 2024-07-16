import { Address, Cell, TonClient, TonClient4 } from "@ton/ton";
import { getHttpEndpoint, getHttpV4Endpoint } from "@orbs-network/ton-access";
import { isKnownMaster, isKnownWallet } from "./known-contracts";
import { getJettonData } from "./utils";
import { simulateActions, SimulationResult } from "./simulation/simulation";

export async function checkForHoneypot(address: Address): Promise<CheckResult> {
    const client = new TonClient({
        endpoint: await getHttpEndpoint({network: "mainnet"})
    });
    const clientV4 = new TonClient4({
        endpoint: await getHttpV4Endpoint({ network: "mainnet" })
    })

    const state = await client.getContractState(address);
    if (state.code === null)
        throw Error("Cannot parse code");
    const codeCell = Cell.fromBoc(state.code)[0];
    const data = await getJettonData(client, address);

    const knownMaster = isKnownMaster(codeCell.hash());
    const knownWallet = isKnownWallet(data.walletCode.hash());

    const simulation = await simulateActions(clientV4, address, data.walletCode);

    return {
        name: data.name,
        symbol: data.symbol,
        knownMaster,
        knownWallet,
        simulation
    }
}

export interface CheckResult {
    name: string;
    symbol: string;
    knownMaster: boolean;
    knownWallet: boolean;
    simulation: SimulationResult | null;
}