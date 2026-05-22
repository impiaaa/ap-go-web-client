import type { MessageNode, Player } from "archipelago.js";
import i18next from "i18next";
import { client } from "./globals";
import { start as start_particles } from "./particles";
import { styleItemElement } from "./utils";

export const text_log = document.getElementById("text-log")!;

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

function addMessages(nodes: MessageNode[]) {
  nodes.forEach(addMessageNode);
  text_log.appendChild(document.createElement("br"));
}

function logError(message: string) {
  const msg_el = document.createElement("span");
  msg_el.appendChild(document.createTextNode(message));
  msg_el.classList.add("error");
  text_log.appendChild(msg_el);
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

  const countdown_dialog = document.getElementById("text-overlay")!;
  const counter_element = countdown_dialog.firstElementChild as HTMLElement;

  const countdown = counter_element
    .getAnimations()
    .find((a) => a instanceof CSSAnimation && a.animationName === "countdown")!;
  countdown.addEventListener("finish", () => {
    countdown_dialog.style.visibility = "hidden";
  });
  client.messages.on("countdown", (text) => {
    if (text.includes(": ")) {
      text = text.substring(text.indexOf(": ") + 2);
    }
    if (text.length > 3) {
      // ignore the first "Starting countdown" message
      return;
    }

    counter_element.textContent = text;
    counter_element.classList.remove("victory");
    counter_element.classList.add("countdown");
    countdown.currentTime = 0;
    countdown_dialog.style.visibility = "visible";
    countdown.play();
  });

  const victory = counter_element
    .getAnimations()
    .find((a) => a instanceof CSSAnimation && a.animationName === "victory")!;
  victory.addEventListener("finish", () => {
    countdown_dialog.style.visibility = "hidden";
  });
  client.messages.on("goaled", (_, player) => {
    if (player.slot !== client.players.self.slot) {
      return;
    }

    counter_element.textContent = i18next.t("text-overlay.victory", "Victory!");
    counter_element.classList.remove("countdown");
    counter_element.classList.add("victory");
    victory.currentTime = 0;
    countdown_dialog.style.visibility = "visible";
    victory.play();
    start_particles();
  });

  client.socket.on("connected", () => {
    text_log.innerHTML = "";
    client.messages.log.forEach((line) => {
      addMessages(line.nodes);
    });
    text_log.scrollTop = text_log.scrollHeight - text_log.clientHeight;
  });
  const text_input_form = document.forms.namedItem("text-input")!;
  const text_input = text_input_form.elements[0] as HTMLInputElement;
  text_input_form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    client.messages.say(text_input.value);
    text_input.value = "";
  });
  window.addEventListener("error", (ev) => {
    logError(
      `${ev.error} ${ev.filename}:${ev.lineno}:${ev.colno}: ${ev.message}`,
    );
  });
  window.addEventListener("unhandledrejection", (ev) => {
    logError(`Unhandled promise rejection: ${ev.reason}`);
  });
}
