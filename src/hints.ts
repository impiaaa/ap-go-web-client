import type { Hint } from "archipelago.js";
import { client } from "./globals";
import { stylePlayerElement } from "./log";
import { updateMarker } from "./map";
import { styleItemElement } from "./utils";

const hint_table = document
  .getElementById("hint-table")!
  .getElementsByTagName("tbody")[0];
function addHint(hint: Hint) {
  const row = document.createElement("tr");
  row.setAttribute("id", `${hint.item.sender.slot}-${hint.item.locationId}`);

  const receiver = document.createElement("td");
  receiver.classList.add("player");
  stylePlayerElement(receiver, hint.item.receiver);
  receiver.appendChild(document.createTextNode(hint.item.receiver.name));
  row.appendChild(receiver);

  const item = document.createElement("td");
  item.classList.add("item");
  styleItemElement(item, hint.item);
  item.appendChild(document.createTextNode(hint.item.name));
  row.appendChild(item);

  const sender = document.createElement("td");
  sender.classList.add("player");
  stylePlayerElement(sender, hint.item.sender);
  sender.appendChild(document.createTextNode(hint.item.sender.name));
  row.appendChild(sender);

  const location = document.createElement("td");
  location.classList.add("location");
  location.appendChild(document.createTextNode(hint.item.locationName));
  row.appendChild(location);

  const entrance = document.createElement("td");
  entrance.classList.add("entrance");
  entrance.appendChild(document.createTextNode(hint.entrance));
  row.appendChild(entrance);

  const status = document.createElement("td");
  status.setAttribute("class", "hint-status");
  status.appendChild(document.createTextNode(hint.found ? "✓" : "✗"));
  row.appendChild(status);

  hint_table.appendChild(row);

  if (hint.item.locationGame === client.game) {
    updateMarker(hint.item, true);
  }
}

export function setUpHintsPage() {
  client.items.on("hintsInitialized", (hints) => hints.forEach(addHint));
  client.items.on("hintReceived", addHint);
  client.items.on("hintFound", (hint) => {
    const status = document
      .evaluate(
        `tr[@id="${hint.item.sender.slot}-${hint.item.locationId}"]/td[@class="hint-status"]`,
        hint_table,
      )
      .iterateNext() as HTMLElement | null;
    if (status) {
      status.innerText = "✓";
    }
  });
  client.socket.on("disconnected", () => {
    hint_table.replaceChildren();
  });
}
