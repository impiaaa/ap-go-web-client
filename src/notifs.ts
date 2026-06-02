import type { MessageNode } from "archipelago.js";
import i18next from "i18next";
import { client, prefs } from "./globals";
import { messageNodesToHtml } from "./log";
import { start as start_particles } from "./particles";
import { isPopoverOpen } from "./utils";

interface SfxPack {
  filler: HTMLAudioElement;
  progression: HTMLAudioElement;
  proguseful: HTMLAudioElement;
  trap: HTMLAudioElement;
  useful: HTMLAudioElement;
  victory?: HTMLAudioElement;
}

const countdowns: HTMLAudioElement[] = [];
const victory_vox: HTMLAudioElement[] = [];
let receive_sfx: SfxPack | null = null;
let send_sfx: SfxPack | null = null;
const notif_queue: [MessageNode[], HTMLAudioElement?][] = [];
let notif_timer: number = -1;
let last_notif_sfx: [string, HTMLAudioElement] | null = null;

function preloadSound(path: string, volume: number) {
  const snd = new Audio(path);
  snd.preload = "auto";
  snd.volume = volume;
  return snd;
}

function showNotification() {
  if (notif_queue.length <= 0) {
    throw "showNotification called with empty queue";
  }
  const notif_container = document.getElementById("notification-container");
  if (notif_container === null) {
    throw "Can't find container";
  }
  const [nodes, sound] = notif_queue.shift()!;
  const notif = document.getElementById("notification");
  while (notif?.firstChild) {
    notif.removeChild(notif.firstChild);
  }
  notif?.appendChild(messageNodesToHtml(nodes));
  notif_container.showPopover();
  notif_timer = window.setTimeout(() => {
    notif_container.hidePopover();
  }, 4000);

  if (sound !== undefined) {
    if (navigator.audioSession !== undefined) {
      navigator.audioSession.type = "transient";
    }
    sound.currentTime = 0;
    sound.play();
  }
}

export function setUpNotifs() {
  const notif_container = document.getElementById("notification-container");
  if (notif_container === null) {
    throw "Can't find container";
  }
  notif_container.addEventListener("toggle", () => {
    if (!isPopoverOpen(notif_container) && notif_queue.length > 0) {
      if (notif_timer > -1) {
        window.clearTimeout(notif_timer);
      }
      showNotification();
    }
  });
  // TODO: click to dismiss
  client.messages.on("message", (message, nodes) => {
    if (
      nodes.some(
        (node) =>
          node.type === "player" &&
          node.player.slot === client.players.self.slot,
      ) &&
      window.location.hash !== "#log"
    ) {
      // Archipelago.js, when it receives a PrintJSON packet, first emits the specific event for the
      // "type" of message, then emits this generic "message" event. Sound effects are only played
      // for "itemSent" messages, but notifications can be shown for any message. So we need to
      // determine which sound to play in the "itemSent" event handler, then "remember" it and
      // recall during the generic "message" handler. Additionally we check that the actual message
      // matches, just to be sure we aren't mixing any up.
      const sound =
        last_notif_sfx?.[0] === message ? last_notif_sfx?.[1] : undefined;
      last_notif_sfx = null;
      notif_queue.push([nodes, sound]);
      if (!isPopoverOpen(notif_container)) {
        showNotification();
      }
    }
  });

  const countdown_dialog = document.getElementById("text-overlay")!;
  const counter_element = countdown_dialog.firstElementChild as HTMLElement;

  let countdown_anim: CSSAnimation | null = null;
  client.messages.on("countdown", (text, value) => {
    if (text.includes(": ")) {
      text = text.substring(text.indexOf(": ") + 2);
    }
    if (text.length > 3) {
      // ignore the first "Starting countdown" message
      return;
    }

    if (value >= 0 && value < countdowns.length) {
      if (navigator.audioSession !== undefined) {
        navigator.audioSession.type = "transient";
      }
      countdowns[value].currentTime = 0;
      countdowns[value].play();
    }

    counter_element.textContent = text;
    counter_element.classList.remove("victory");
    counter_element.classList.add("countdown");

    countdown_dialog.showPopover();

    if (countdown_anim === null) {
      countdown_anim = counter_element
        .getAnimations()
        .find(
          (a) => a instanceof CSSAnimation && a.animationName === "countdown",
        ) as CSSAnimation;
      countdown_anim.addEventListener("finish", () => {
        countdown_dialog.hidePopover();
      });
    }
    countdown_anim.currentTime = 0;
    countdown_anim.play();
  });

  let victory_anim: CSSAnimation | null = null;
  // client.messages.on("serverChat", () => {
  client.messages.on("goaled", (_, player) => {
    if (player.slot !== client.players.self.slot) {
      return;
    }

    const vox =
      victory_vox.length > 0
        ? victory_vox[Math.floor(Math.random() * victory_vox.length)]
        : null;
    if (send_sfx?.victory) {
      if (navigator.audioSession !== undefined) {
        navigator.audioSession.type = "transient-solo";
      }

      if (vox !== null) {
        setTimeout(
          () => {
            vox.currentTime = 0;
            vox.play();
          },
          (23 / 28) * send_sfx.victory.duration * 1000,
        );
      }
      // TODO: stop all other sfx and prevent them from playing
      send_sfx.victory.currentTime = 0;
      send_sfx.victory.play();
    } else if (vox !== null) {
      vox.currentTime = 0;
      vox.play();
    }

    counter_element.textContent = i18next.t("text-overlay.victory", "Victory!");
    counter_element.classList.remove("countdown");
    counter_element.classList.add("victory");

    countdown_dialog.showPopover();

    if (victory_anim === null) {
      victory_anim = counter_element
        .getAnimations()
        .find(
          (a) => a instanceof CSSAnimation && a.animationName === "victory",
        ) as CSSAnimation;
      victory_anim.addEventListener("finish", () => {
        countdown_dialog.hidePopover();
      });
    }
    if (send_sfx?.victory) {
      // HACK: animation duration is hard-coded here
      victory_anim.playbackRate = 4 / send_sfx.victory.duration;
    }
    victory_anim.currentTime = 0;
    victory_anim.play();

    start_particles();
  });

  client.messages.on("itemSent", (message, item) => {
    if (
      item.sender.slot !== client.players.self.slot &&
      item.receiver.slot !== client.players.self.slot
    ) {
      return;
    }
    const sfx_pack =
      item.sender.slot === client.players.self.slot ? send_sfx : receive_sfx;
    if (sfx_pack !== null) {
      last_notif_sfx = [
        message,
        item.trap
          ? sfx_pack.trap
          : item.useful
            ? item.progression
              ? sfx_pack.proguseful
              : sfx_pack.useful
            : item.progression
              ? sfx_pack.progression
              : sfx_pack.filler,
      ];
    }
  });
}

function loadSfxPack(
  pack_name: string,
  volume: number,
  with_victory: boolean,
): SfxPack | null {
  if (pack_name.length > 0) {
    const ext = pack_name === "8bit" ? "mp3" : "ogg";
    return {
      filler: preloadSound(`sfx/${pack_name}/Filler.${ext}`, volume),
      progression: preloadSound(`sfx/${pack_name}/Progression.${ext}`, volume),
      proguseful: preloadSound(`sfx/${pack_name}/ProgUseful.${ext}`, volume),
      trap: preloadSound(`sfx/${pack_name}/Trap.${ext}`, volume),
      useful: preloadSound(`sfx/${pack_name}/Useful.${ext}`, volume),
      victory: with_victory
        ? preloadSound(`sfx/${pack_name}/Victory.${ext}`, volume)
        : undefined,
    };
  } else {
    return null;
  }
}

export function preloadAudio() {
  countdowns.splice(0);
  victory_vox.splice(0);
  if (prefs.countdown_vox.length > 0) {
    countdowns[0] = preloadSound(
      `vox/${prefs.countdown_vox}/go.ogg`,
      prefs.countdown_vox_volume,
    );
    for (let i = 1; i <= 10; i++) {
      countdowns[i] = preloadSound(
        `vox/${prefs.countdown_vox}/${i}.ogg`,
        prefs.countdown_vox_volume,
      );
    }
    victory_vox[0] = preloadSound(
      `vox/${prefs.countdown_vox}/mission_completed.ogg`,
      prefs.countdown_vox_volume,
    );
    victory_vox[1] = preloadSound(
      `vox/${prefs.countdown_vox}/objective_achieved.ogg`,
      prefs.countdown_vox_volume,
    );
  }
  send_sfx = loadSfxPack(prefs.send_sfx, prefs.send_sfx_volume, true);
  receive_sfx = loadSfxPack(prefs.receive_sfx, prefs.receive_sfx_volume, false);
}
