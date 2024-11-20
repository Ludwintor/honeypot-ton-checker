import { Address, Cell, Dictionary } from "@ton/core";
import { sha256 } from "@ton/crypto";
import { TonClient } from "@ton/ton";
import { JettonInfo } from "./types";

const ONCHAIN_FLAG = 0x00;
const OFFCHAIN_FLAG = 0x01;

export async function getJettonInfo(client: TonClient, address: Address): Promise<JettonInfo> {
    const stack = (await client.runMethod(address, "get_jetton_data")).stack;
    const supply = stack.readBigNumber();
    stack.skip(1);
    const admin = stack.readAddressOpt();
    const contentCell = stack.readCell();
    const jettonWalletCode = stack.readCell();

    let parsedContent: JettonContent;
    try {
        parsedContent = await parseContent(contentCell);
    }
    catch {
        console.log("Cannot parse jetton metadata (probably url are unavailable). Relaying on ton api...");
        const response = await fetch(`https://tonapi.io/v2/jettons/${address}`);
        const json = await response.json();
        const meta = json["metadata"];
        parsedContent = {
            name: meta["name"],
            symbol: meta["symbol"],
            decimals: meta["decimals"]
        };
    }
    return {
        address: address,
        ...parsedContent,
        admin: admin,
        supply: supply,
        walletCode: jettonWalletCode
    }
}

async function parseContent(content: Cell): Promise<JettonContent> {
    const cs = content.beginParse();
    const layout = cs.loadUint(8);
    if (layout === OFFCHAIN_FLAG) {
        const url = cs.loadStringTail();
        const response = await fetch(url);
        return await response.json() as JettonContent;
    } else if (layout === ONCHAIN_FLAG) {
        const dict = cs.loadDict(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
        let name = dict.get(await sha256("name"))?.beginParse().loadStringTail();
        let symbol = dict.get(await sha256("symbol"))?.beginParse().loadStringTail();
        let decimals = dict.get(await sha256("decimals"))?.beginParse().loadStringTail();

        const uriCell = dict.get(await sha256("uri"));
        if (uriCell) {
            const slice = uriCell.beginParse();
            slice.skip(8); // skip snake prefix?
            const uri = slice.loadStringTail();
            const response = await fetch(uri);
            const json = await response.json();
            name ??= json["name"];
            symbol ??= json["symbol"];
            decimals ??= json["decimals"];
        }

        return {
            name: name ?? "NOT_FOUND",
            symbol: symbol ?? "NOT_FOUND",
            decimals: Number.isInteger(decimals) ? Number.parseInt(decimals!) : 9
        }
    }
    throw new Error("Unknown layout format");
}

interface JettonContent {
    name: string;
    symbol: string;
    decimals: number;
}