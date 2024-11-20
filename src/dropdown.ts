const SELECTED_SUFFIX = "-selected";
const LIST_SUFFIX = "-list";

export class Dropdown {
    private dropdown: HTMLDivElement;
    private selectedElement: HTMLDivElement;
    private list: HTMLUListElement;
    private isActive: boolean = false;
    private isEnabled: boolean = true;
    private selectedIdx: number = -1;

    public constructor(dropdownId: string) {
        this.dropdown = document.getElementById(dropdownId) as HTMLDivElement;
        this.selectedElement = document.getElementById(dropdownId + SELECTED_SUFFIX) as HTMLDivElement;
        this.list = document.getElementById(dropdownId + LIST_SUFFIX) as HTMLUListElement;
        this.hide();
        this.hideDropdown();
        this.selectedElement.addEventListener("click", () => {
            this.isActive ? this.hideDropdown() : this.showDropdown();
        });
        document.addEventListener("click", e => {
            if (!this.isActive)
                return;
            const path = e.composedPath();
            if (!path.includes(this.dropdown))
                this.hideDropdown();
        });
    }

    public get selected(): number {
        return this.selectedIdx;
    }

    public get enabled(): boolean {
        return this.isEnabled;
    }

    public set enabled(isEnabled: boolean) {
        this.isEnabled = isEnabled;
        if (!isEnabled)
            this.hideDropdown();
    }

    public show() {
        this.dropdown.style.display = "block";
    }

    public hide() {
        this.dropdown.style.display = "none";
    }

    public showDropdown() {
        if (!this.isEnabled)
            return;
        this.isActive = true;
        this.selectedElement.classList.remove("arrow-up");
        this.selectedElement.classList.add("arrow-down");
        this.list.classList.remove("hide");
        this.list.classList.add("show");
    }

    public hideDropdown() {
        this.isActive = false;
        this.selectedElement.classList.remove("arrow-down");
        this.selectedElement.classList.add("arrow-up");
        this.list.classList.remove("show");
        this.list.classList.add("hide");
    }

    public clearItems() {
        this.list.replaceChildren(...[]);
        this.selectedIdx = -1;
        this.selectedElement.textContent = null;
    }

    public setupItems(items: string[], onClick: (index: number) => void) {
        if (items.length === 0) {
            this.clearItems();
            return;
        }
        const itemsList: HTMLLIElement[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const element = document.createElement("li");
            element.textContent = item;
            const index = i;
            element.addEventListener("click", () => {
                this.select(index);
                this.hideDropdown();
                onClick(index);
            });
            itemsList.push(element);
        }
        this.list.replaceChildren(...itemsList);
        this.select(0);
    }

    public select(index: number) {
        this.selectedIdx = index;
        this.selectedElement.textContent = this.list.children.item(index)?.textContent ?? null;
    }
}