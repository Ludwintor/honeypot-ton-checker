import { Address, toNano } from "@ton/core";
import { TonClient, TonClient4 } from "@ton/ton";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { Blockchain, RemoteBlockchainStorage, wrapTonClient4ForRemote } from "@ton/sandbox";
import { JettonInfo, Risk, Step } from "./types";
import { DedustPoolFinder, StonfiPoolFinder, Dex, PoolFinder, PoolInfo } from "./dex";
import { Simulation, DedustSimulation, StonfiV1Simulation, SimulationResult, StageResult, StonfiV2Simulation } from "./simulation";
import { Dropdown } from "./dropdown";
import { isKnownWallet } from "./known-contracts";
import { getJettonInfo } from "./utils";
import { VoidContractsMeta } from "./meta";

const CURRENCY_FORMAT = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
});

const headerColors = {
    [Risk.LOW]: "#4da942",
    [Risk.MEDIUM]: "#a9a942",
    [Risk.HIGH]: "#b58d42",
    [Risk.DANGER]: "#9f4e4e",
    [Risk.UNKNOWN]: "#9b9b9b"
}

const stepsColors = {
    [Risk.LOW]: "#75ff80",
    [Risk.MEDIUM]: "#ffff75",
    [Risk.HIGH]: "#ffcd70",
    [Risk.DANGER]: "#ff8080",
    [Risk.UNKNOWN]: "#9b9b9b"
}

const summaryTexts = {
    [Risk.LOW]: "SAFE",
    [Risk.MEDIUM]: "CHECK CAREFULLY",
    [Risk.HIGH]: "! HIGH RISK !",
    [Risk.DANGER]: "!!! DANGEROUS !!!",
    [Risk.UNKNOWN]: "UNABLE TO PERFORM ALL CHECKS"
}

const client = new TonClient({
    endpoint: await getHttpEndpoint({ network: "mainnet" })
});
const clientV4 = new TonClient4({
    endpoint: "https://mainnet-v4.tonhubapi.com"
});

const seqno = (await clientV4.getLastBlock()).last.seqno;
const chain = await Blockchain.create({
    storage: new RemoteBlockchainStorage(wrapTonClient4ForRemote(clientV4), seqno),
    meta: VoidContractsMeta
});
const poolFinders: PoolFinder[] = [
    DedustPoolFinder.create(client),
    StonfiPoolFinder.create(client)
];
let masterInfo: JettonInfo | null = null;
let pools: PoolInfo[] | null = null;

const addressInput = document.getElementById("address") as HTMLInputElement;
const checkBtn = document.getElementById("check") as HTMLButtonElement;
const jettonLabel = document.getElementById("jname") as HTMLDivElement;
const summaryContainer = document.getElementById("summary") as HTMLDivElement;
const resultContainer = document.getElementById("result") as HTMLDivElement;
const stepsContainer = document.getElementById("steps") as HTMLUListElement;
const donateCopy = document.getElementById("donate") as HTMLAnchorElement;
const poolsDropdown = new Dropdown("pools");

let donateCopyTimeout: number;

checkBtn.addEventListener("click", () => {
    const address = addressInput.value.trim();
    if (!Address.isFriendly(address) && !Address.isRaw(address))
	    return;
    const url = new URL(window.location.href);
    url.searchParams.set("address", address);
    history.pushState(null, "", url);
    checkAddress(Address.parse(address));
});
donateCopy.addEventListener("click", () => {
    clearTimeout(donateCopyTimeout)
    navigator.clipboard.writeText("UQA705AUWErQe9Ur56CZz-v6N9J2uw298w-31ZCu475hT8U4");
    donateCopy.textContent = "WALLET COPIED!";
    donateCopyTimeout = window.setTimeout(() => {
        donateCopy.textContent = "Donate";
    }, 2500);
});

const params = new URLSearchParams(window.location.search);
const queryAddress = params.get("address");

if (queryAddress !== null && (Address.isFriendly(queryAddress) || Address.isRaw(queryAddress))) {
    const address = Address.parse(queryAddress);
    addressInput.value = queryAddress;
    checkAddress(address);
}

function getSimulation(chain: Blockchain, dex: Dex, master: Address, pool: Address, amount: bigint)
    : Promise<Simulation> {
    switch (dex) {
        case Dex.DEDUST:
            return DedustSimulation.create(chain, master, pool, amount);
        case Dex.STONFI_V1:
            return StonfiV1Simulation.create(chain, master, pool, amount);
        case Dex.STONFI_V2:
            return StonfiV2Simulation.create(chain, master, pool, amount);
        default:
            throw new Error(`${dex} dex isn't supported`);
    }
}

async function checkAddress(address: Address) {
    poolsDropdown.enabled = false;
    checkBtn.disabled = true;
    summaryContainer.style.display = "block";
    resultContainer.textContent = "PENDING...";
    resultContainer.style.backgroundColor = headerColors[Risk.UNKNOWN];
    poolsDropdown.show();
    stepsContainer.replaceChildren(...[]);
    try {
        if (!masterInfo?.address.equals(address)) {
            jettonLabel.textContent = "";
            poolsDropdown.clearItems();
            masterInfo = await getJettonInfo(client, address);
            const poolTasks = await Promise.all(poolFinders.map(x => x.findPools(address)));
            pools = poolTasks.flat()
                .filter(x => x !== null)
                .sort((a, b) => b.reservesUsd - a.reservesUsd);
            jettonLabel.textContent = `${masterInfo.name} - ${masterInfo.symbol}`;
            if (pools.length === 0) {
                resultContainer.textContent = "NO POOLS FOUND";
                return;
            }
            const items = pools.map(pool => {
                const liquidity = CURRENCY_FORMAT.format(pool.reservesUsd);
                return `${pool.name} (Liquidity: $${liquidity})`;
            });
            poolsDropdown.setupItems(items, async selected => {
                if (!masterInfo || !pools)
                    return;
                poolsDropdown.enabled = false;
                checkBtn.disabled = true;
                const pool = pools[selected];
                try {
                    await checkHoneypot(masterInfo, pool);
                } catch (e: any) {
                    resultContainer.textContent = "UNEXPECTED ERROR. TRY AGAIN";
                    console.error(e);
                } finally {
                    poolsDropdown.enabled = true;
                    checkBtn.disabled = false;
                }
            });
        }
        if (pools == null)
            throw new Error("we should have pools here");
        const pool = pools[poolsDropdown.selected];
        await checkHoneypot(masterInfo, pool);
    } catch (e: any) {
        resultContainer.textContent = "UNEXPECTED ERROR. TRY AGAIN";
        console.error(e);
    } finally {
        poolsDropdown.enabled = true;
        checkBtn.disabled = false;
    }
}

async function checkHoneypot(jetton: JettonInfo, pool: PoolInfo) {
    resultContainer.textContent = "PENDING...";
    resultContainer.style.backgroundColor = headerColors[Risk.UNKNOWN];
    stepsContainer.replaceChildren(...[]);
    const steps: Step[] = [];
    const simulation = await getSimulation(chain, pool.dex, jetton.address, pool.address, toNano(30));
    const knownWallet = isKnownWallet(jetton.walletCode.hash());
    const simResult = await simulation.simulate();
    steps.push({
        title: knownWallet ? "STANDARD WALLET" : "NON-STANDARD WALLET",
        description: knownWallet ? "WELL-KNOWN CONTRACT WITH OPEN SOURCE CODE" 
            : "THIS CONTRACT IS SUS! PROCEED WITH CAUTION",
        risk: knownWallet ? Risk.LOW : Risk.MEDIUM
    });

    mapSimulation(steps, simResult);

    const risk = steps.reduce<Risk>((max, cur) => cur.risk > max ? cur.risk : max, Risk.LOW);
    resultContainer.textContent = summaryTexts[risk];
    resultContainer.style.backgroundColor = headerColors[risk];

    renderSteps(steps);
}

function mapSimulation(steps: Step[], sim: SimulationResult) {
    steps.push(createSimulationStep(sim.buy, "BUY"));
    steps.push(createSimulationStep(sim.transfer, "TRANSFER"));
    steps.push(createSimulationStep(sim.sell, "SELL"));
}

function createSimulationStep(stage: StageResult | null, stageName: string): Step {
    return stage === null 
	? {
	    title: `CAN'T ${stageName} JETTON`,
	    description: `${stageName} COMPLETED WITH ERROR. POSSIBLE LOSS OF FUNDS!`,
	    risk: Risk.DANGER
	}
	: {
	    title: `${stageName} TAX: ${(stage.loss * 100).toFixed(2)}%`,
	    description: stage.loss > 0 ? "YOU WILL RECEIVE LESS FUNDS THAN EXPECTED."
            : "YOU WILL RECEIVE EXPECTED AMOUNT",
	    risk: lossToRisk(stage.loss)
	}
}

function lossToRisk(loss: number): Risk {
    return loss >= 0.5 ? Risk.DANGER
	     : loss >= 0.2 ? Risk.HIGH
	     : loss > 0    ? Risk.MEDIUM
	     : Risk.LOW;
}

function renderSteps(steps: Step[]) {
    const list: HTMLLIElement[] = [];
    for (const step of steps) {
	const item = document.createElement("li");
	const titleEl = document.createElement("h4");
	const descEl = document.createElement("p");
	const color = stepsColors[step.risk];
        titleEl.textContent = step.title;
        titleEl.classList.add("text-l");
        titleEl.style.color = color;
        descEl.textContent = step.description;
        descEl.classList.add("text-m");
        item.style.borderLeftColor = color;
        item.append(titleEl, descEl);
        list.push(item);
    }
    stepsContainer.replaceChildren(...list);
}