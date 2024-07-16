import { Address } from "@ton/core";
import { checkForHoneypot } from "./checker";
import { SimulationResult, StageResult } from "./simulation/simulation";

const enum Risk {
    LOW,
    MEDIUM,
    HIGH,
    DANGER,
    UNKNOWN
}

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

const addressInput = document.getElementById("address") as HTMLInputElement;
const checkBtn = document.getElementById("check") as HTMLButtonElement;
const jettonLabel = document.getElementById("jname") as HTMLDivElement;
const summaryContainer = document.getElementById("summary") as HTMLDivElement;
const resultContainer = document.getElementById("result") as HTMLDivElement;
const stepsContainer = document.getElementById("steps") as HTMLUListElement;

checkBtn.addEventListener("click", async () => {
    const address = addressInput.value;
    if (!Address.isFriendly(address) && !Address.isRaw(address))
	return;
    const url = new URL(window.location.href);
    url.searchParams.set("address", address);
    history.pushState(null, "", url);
    checkHoneypot(Address.parse(address));
});

const params = new URLSearchParams(window.location.search);
const queryAddress = params.get("address");

if (queryAddress !== null && (Address.isFriendly(queryAddress) || Address.isRaw(queryAddress))) {
    const address = Address.parse(queryAddress);
    addressInput.value = queryAddress;
    checkHoneypot(address);
}

function checkHoneypot(address: Address) {
    summaryContainer.style.display = "block";
    resultContainer.textContent = "PENDING...";
    resultContainer.style.backgroundColor = headerColors[Risk.UNKNOWN];
    jettonLabel.textContent = "";
    const steps: Step[] = [];
    (async () => {
	const result = await checkForHoneypot(address);
	let summary: Risk | null = null;
	jettonLabel.textContent = `${result.name} - $${result.symbol}`;
	steps.push({
	    title: result.knownMaster ? "STANDARD MASTER" : "NON-STANDARD MASTER",
	    description: result.knownMaster ? "THIS CONTRACT USES COMMUNITY-VALIDATED CODE" 
		    : "THIS CONTRACT CONTAINS CUSTOM CODE. PROCEED WITH CAUTION",
	    risk: result.knownMaster ? Risk.LOW : Risk.MEDIUM
	});
	
	steps.push({
	    title: result.knownWallet ? "STANDARD WALLET" : "NON-STANDARD WALLET",
	    description: result.knownWallet ? "THIS JETTON WALLET CONTRACT USES COMMUNITY-VALIDATED CODE"
		    : "THIS JETTON WALLET CONTRACT CONTAINS CUSTOM CODE. PROCEED WITH CAUTION",
	    risk: result.knownWallet ? Risk.LOW : Risk.MEDIUM
	});

	if (result.simulation !== null)
	    mapSimulation(steps, result.simulation);
	else
	    summary = Risk.UNKNOWN;

	summary ??= steps.reduce<Risk>((max, cur) => cur.risk > max ? cur.risk : max, Risk.LOW);
	resultContainer.textContent = summaryTexts[summary];
	resultContainer.style.backgroundColor = headerColors[summary];

	renderSteps(steps);
    })()
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
	    description: stage.loss > 0 ? "YOU RECEIVE LESS FUNDS THAN EXPECTED."
            : "YOU RECEIVE EXPECTED AMOUNT",
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

interface Step {
    title: string;
    description: string;
    risk: Risk;
}