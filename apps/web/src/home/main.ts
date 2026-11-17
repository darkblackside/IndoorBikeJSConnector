// Game hub: an Offline tab (single-player games) and an Online tab (multiplayer, none yet).
import "@darkblackside/ui/themes/gamification.css";
import "@darkblackside/ui/base.css";
import "@darkblackside/ui/button.js";
import "@darkblackside/ui/card.js";
import "@darkblackside/ui/page-header.js";
import "@darkblackside/ui/tag.js";
import "./style.css";
import { offlineGames, onlineGames, type GameEntry } from "./games.ts";

type Tab = "offline" | "online";
const TABS: Tab[] = ["offline", "online"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function gameCard(game: GameEntry): HTMLElement {
  const card = document.createElement("bm-card");
  card.className = "game";
  const heading = el("h2", { textContent: game.title });
  heading.slot = "heading";
  const tags = el(
    "div",
    { className: "tags" },
    ...game.tags.map((text) => Object.assign(document.createElement("bm-tag"), { textContent: text })),
  );
  const play = document.createElement("bm-button");
  play.setAttribute("variant", "primary");
  play.setAttribute("href", game.href);
  play.textContent = "Play";
  card.append(heading, el("p", { textContent: game.description }), tags, el("div", { className: "actions" }, play));
  return card;
}

function emptyState(title: string, text: string): HTMLElement {
  return el("div", { className: "empty" }, el("p", { className: "empty-title", textContent: title }), el("p", { className: "muted", textContent: text }));
}

function render(container: HTMLElement, games: GameEntry[], empty: HTMLElement) {
  container.replaceChildren(...(games.length ? games.map(gameCard) : [empty]));
}

render(document.querySelector("#offline-games")!, offlineGames, emptyState("No offline games yet", ""));
render(
  document.querySelector("#online-games")!,
  onlineGames,
  emptyState("Nothing here yet", "Multiplayer rides are on the way: race friends and survive the horde together."),
);

// --- tabs (WAI-ARIA tabs pattern; the URL hash keeps the tab, so links like ../#online work) ---
const tabButton = (t: Tab) => document.querySelector<HTMLButtonElement>(`#tab-${t}`)!;
const panel = (t: Tab) => document.querySelector<HTMLElement>(`#panel-${t}`)!;

function select(tab: Tab, focus = false) {
  for (const t of TABS) {
    const on = t === tab;
    tabButton(t).setAttribute("aria-selected", String(on));
    tabButton(t).tabIndex = on ? 0 : -1;
    panel(t).hidden = !on;
  }
  if (focus) tabButton(tab).focus();
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
}

const fromHash = (): Tab => (TABS.includes(location.hash.slice(1) as Tab) ? (location.hash.slice(1) as Tab) : "offline");

for (const t of TABS) {
  tabButton(t).addEventListener("click", () => select(t));
  tabButton(t).addEventListener("keydown", (e) => {
    const i = TABS.indexOf(t);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS.at(-1) : undefined;
    if (next) {
      e.preventDefault();
      select(next, true);
    }
  });
}
window.addEventListener("hashchange", () => select(fromHash()));
select(fromHash());
