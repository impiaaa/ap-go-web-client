import i18next from "i18next";
import { client, prefs } from "./globals";
import { start as start_particles } from "./particles";

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

function preloadSound(path: string) {
  const snd = new Audio(path);
  snd.preload = "auto";
  return snd;
}

export function setUpNotifs() {
  client.messages.on("message", (_message, nodes) => {
    if (
      nodes.some(
        (node) =>
          node.type === "player" &&
          node.player.slot === client.players.self.slot,
      ) &&
      window.location.hash !== "#log"
    ) {
      // TODO: show notification
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

    if (send_sfx?.victory) {
      if (navigator.audioSession !== undefined) {
        navigator.audioSession.type = "transient-solo";
      }

      if (victory_vox.length > 0) {
        const vox = victory_vox[Math.floor(Math.random() * victory_vox.length)];
        setTimeout(
          () => {
            vox.play();
          },
          (23 / 28) * send_sfx.victory.duration * 1000,
        );
      }
      // TODO: stop all other sfx and prevent them from playing
      send_sfx.victory.play();
    } else if (victory_vox.length > 0) {
      victory_vox[Math.floor(Math.random() * victory_vox.length)].play();
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

  client.messages.on("itemSent", (_, item) => {
    if (
      item.sender.slot !== client.players.self.slot &&
      item.receiver.slot !== client.players.self.slot
    ) {
      return;
    }
    // TODO: queue sounds, 4 second intervals
    const sfx_pack =
      item.sender.slot === client.players.self.slot ? send_sfx : receive_sfx;
    if (sfx_pack !== null) {
      const sound = item.trap
        ? sfx_pack.trap
        : item.useful
          ? item.progression
            ? sfx_pack.proguseful
            : sfx_pack.useful
          : item.progression
            ? sfx_pack.progression
            : sfx_pack.filler;
      if (navigator.audioSession !== undefined) {
        navigator.audioSession.type = "transient";
      }
      sound.play();
    }
  });
}

function loadSfxPack(pack_name: string, with_victory: boolean): SfxPack | null {
  if (pack_name.length > 0) {
    const ext = pack_name === "8bit" ? "mp3" : "ogg";
    return {
      filler: preloadSound(`sfx/${pack_name}/Filler.${ext}`),
      progression: preloadSound(`sfx/${pack_name}/Progression.${ext}`),
      proguseful: preloadSound(`sfx/${pack_name}/ProgUseful.${ext}`),
      trap: preloadSound(`sfx/${pack_name}/Trap.${ext}`),
      useful: preloadSound(`sfx/${pack_name}/Useful.${ext}`),
      victory: with_victory
        ? preloadSound(`sfx/${pack_name}/Victory.${ext}`)
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
    countdowns[0] = preloadSound(`vox/${prefs.countdown_vox}/go.ogg`);
    for (let i = 1; i <= 10; i++) {
      countdowns[i] = preloadSound(`vox/${prefs.countdown_vox}/${i}.ogg`);
    }
    victory_vox[0] = preloadSound(
      `vox/${prefs.countdown_vox}/mission_completed.ogg`,
    );
    victory_vox[1] = preloadSound(
      `vox/${prefs.countdown_vox}/objective_achieved.ogg`,
    );
  }
  send_sfx = loadSfxPack(prefs.send_sfx, true);
  receive_sfx = loadSfxPack(prefs.receive_sfx, false);
}
