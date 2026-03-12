import type { Item, MessageNode, Player } from "archipelago.js";
import { client } from "./globals";

export const text_log = document.getElementById("text-log")!;

export function styleItemElement(element: HTMLElement, item: Item) {
  if (item.progression) element.classList.add("progression");
  if (item.useful) element.classList.add("useful");
  if (item.trap) element.classList.add("trap");
}

export function stylePlayerElement(element: HTMLElement, player: Player) {
  if (
    player.slot === client.players.self.slot ||
    client.players.slots[player.slot].group_members.includes(
      client.players.self.slot,
    )
  ) {
    element.classList.add("self");
  }
}

function addMessageNode(node: MessageNode) {
  const msg_el = document.createElement("span");
  msg_el.appendChild(document.createTextNode(node.text));
  msg_el.classList.add(node.type);
  switch (node.type) {
    case "color":
      if (node.color === "bold") {
        msg_el.style.setProperty("font-weight", "bold");
      } else if (node.color === "underline") {
        msg_el.style.setProperty("text-decoration", "underline");
      } else if (node.color.endsWith("_bg")) {
        msg_el.style.setProperty(
          "background-color",
          node.color.substring(0, node.color.length - 3),
        );
      } else {
        msg_el.style.setProperty("color", node.color);
      }
      break;

    case "player":
      stylePlayerElement(msg_el, node.player);
      break;

    case "item":
      styleItemElement(msg_el, node.item);
      break;

    default:
      break;
  }
  text_log.appendChild(msg_el);
}

export function addMessages(nodes: MessageNode[]) {
  nodes.forEach(addMessageNode);
  text_log.appendChild(document.createElement("br"));
}

export function setUpLogPage() {
  client.messages.on("message", (message, nodes) => {
    console.log(message);
    const is_at_bottom =
      text_log.scrollTop >= text_log.scrollHeight - text_log.clientHeight - 4;
    if (text_log.childElementCount >= client.options.maximumMessages * 2) {
      text_log.removeChild(text_log.firstElementChild!);
      text_log.removeChild(text_log.firstElementChild!);
    }
    addMessages(nodes);
    if (is_at_bottom) {
      text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;
    }
  });
  const text_input_form = document.forms.namedItem("text-input")!;
  const text_input = text_input_form.elements[0] as HTMLInputElement;
  text_input_form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    client.messages.say(text_input.value);
    text_input.value = "";
  });
}
