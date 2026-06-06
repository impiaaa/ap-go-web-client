import { points_in_radius, set_up_with_saved_points } from "@pkgs/gen/gen";
import { clientStatuses, type Item } from "archipelago.js";
import i18next from "i18next";
import { LngLat } from "maplibre-gl";
import {
  setConnectDisabled,
  setConnectionMessage,
  setConnectText,
  setFormDisabled,
  stopTracking,
} from "./connect";
import {
  COLLECTION_DISTANCE_BASE_M,
  COLLECTION_DISTANCE_INCREMENT_M,
  client,
  game_data,
  game_state,
  generator_internal,
  LONG_MACGUFFIN_ITEMS,
  prefs,
  SAVED_GAME_KEY,
  SCOUTING_DISTANCE_BASE_M,
  SCOUTING_DISTANCE_INCREMENT_M,
  SHORT_MACGUFFIN_ITEMS,
  setGameState,
  setGeneratorInternal,
  slot_data,
} from "./globals";
import {
  clearMarkers,
  hideMapPage,
  setFogOfWarVisible,
  showMapPage,
} from "./map";
import { playSound, preloadSound, setMuted } from "./notifs";
import { GameState, Goal, ItemType } from "./types";
import { coordinatesApproximatelyEqual } from "./utils";

const dialog_trap_queue: Item[] = [];
let displaying_dialog_trap: number = -1;
const timed_trap_timers = new Map<ItemType, [number, number, number]>(); // item type -> [start time of currently active trap, item index of currently active trap, timer ID]
let silence: HTMLAudioElement | null = null;

export function getKeyProgress(): number {
  return client.items.received.filter((item) => item.id === ItemType.Key)
    .length;
}

export function getScoutingDistance(): number {
  return (
    client.items.received.filter(
      (item) => item.id === ItemType.ScoutingDistance,
    ).length *
      SCOUTING_DISTANCE_INCREMENT_M +
    SCOUTING_DISTANCE_BASE_M
  );
}

export function getCollectionDistance(): number {
  return (
    client.items.received.filter(
      (item) => item.id === ItemType.CollectionDistance,
    ).length *
      COLLECTION_DISTANCE_INCREMENT_M +
    COLLECTION_DISTANCE_BASE_M
  );
}

let last_known_location: LngLat | undefined;

function checkLastKnownLocation() {
  if (last_known_location) {
    checkLocations(last_known_location);
  }
}

export function checkLocations(coords: LngLat) {
  if (!prefs.home || !slot_data || game_data.points.size === 0) {
    return;
  }

  last_known_location = coords;

  const scoutingDistance = getScoutingDistance();
  const collectionDistance = getCollectionDistance();

  if (
    coords.distanceTo(LngLat.convert(prefs.home)) >
    slot_data.maximum_distance + Math.max(scoutingDistance, collectionDistance)
  ) {
    // Don't check for locations that are too far away from home, since the ENU projection breaks
    // down and we risk checking incorrect locations.
    return;
  }

  const key_progression = getKeyProgress();

  if (!generator_internal) {
    setGeneratorInternal(
      set_up_with_saved_points(new Float64Array(prefs.home), game_data.points),
    );
  }

  let scouts: undefined | null | Array<number> = points_in_radius(
    generator_internal!,
    coords.toArray(),
    scoutingDistance,
  );
  if (scouts === null) {
    console.error("Error getting scouting locations");
  }
  scouts = scouts?.filter(
    (location_id) => !game_data.scouted_locations.has(location_id),
  );
  if (scouts && scouts.length > 0) {
    console.log("Scouting locations:", scouts);
    client.scout(scouts);
  }

  let checks: undefined | null | Array<number> = points_in_radius(
    generator_internal!,
    coords.toArray(),
    collectionDistance,
  );
  if (checks === null) {
    console.error("Error getting check locations");
  }
  checks = checks?.filter((location_id) => {
    const location_name = client.package.lookupLocationName(
      client.game,
      location_id,
    );
    const trip = slot_data?.trips[location_name];
    const checked = client.room.checkedLocations.includes(location_id);
    return !checked && trip && key_progression >= trip.key_needed;
  });
  if (checks && checks.length > 0) {
    console.log("Checking locations:", checks);
    client.check(...checks);

    if (
      client.room.missingLocations.length === 0 &&
      slot_data?.goal === Goal.Allsanity
    ) {
      client.goal();
    }
  }
}

export function saveGame() {
  localStorage.setItem(
    SAVED_GAME_KEY,
    JSON.stringify({
      home: prefs.home,
      last_displayed_trap: game_data.last_displayed_dialog_trap,
      points: Object.fromEntries(game_data.points),
      scouted_locations: Object.fromEntries(game_data.scouted_locations),
      seed: client.room.seedName,
      timed_traps: Object.fromEntries(timed_trap_timers),
    }),
  );
}

export function loadGame() {
  game_data.scouted_locations.clear();
  game_data.last_displayed_dialog_trap = -1;

  dialog_trap_queue.splice(0);
  displaying_dialog_trap = -1;
  timed_trap_timers.clear();

  const saved_game_json = localStorage.getItem(SAVED_GAME_KEY);
  if (!saved_game_json) return false;

  const saved_game = JSON.parse(saved_game_json);
  if (
    typeof saved_game !== "object" ||
    saved_game.seed !== client.room.seedName
  ) {
    // We're connecting to a different game than the one we were connected to the last time we
    // saved, so throw away all progress.
    return false;
  }

  if (typeof saved_game.scouted_locations === "object") {
    for (const location_id_str in saved_game.scouted_locations) {
      game_data.scouted_locations.set(
        parseInt(location_id_str, 10),
        saved_game.scouted_locations[location_id_str],
      );
    }
  }

  if (typeof saved_game.last_displayed_trap === "number") {
    game_data.last_displayed_dialog_trap = saved_game.last_displayed_trap;
  } else if (Array.isArray(saved_game.displayed_trap_locations)) {
    const displayed_trap_locations: any[] = saved_game.displayed_trap_locations;
    // find the last index of client.items.received where item in saved_game.displayed_trap_locations
    game_data.last_displayed_dialog_trap = Math.max(
      ...client.items.received.map((item, index) =>
        displayed_trap_locations.some(
          (trap) =>
            Array.isArray(trap) &&
            trap.length === 2 &&
            item.sender.slot === trap[0] &&
            item.locationId === trap[1],
        )
          ? index
          : -1,
      ),
    );
  }

  if (typeof saved_game.timed_traps === "object") {
    for (const item_type in saved_game.timed_traps) {
      const obj = saved_game.timed_traps[item_type];
      if (
        Array.isArray(obj) &&
        obj.length >= 2 &&
        typeof obj[0] === "number" &&
        typeof obj[1] === "number"
      ) {
        timed_trap_timers.set(parseInt(item_type, 10), [obj[0], obj[1], -1]);
      }
    }
  }

  if (typeof saved_game.points === "object") {
    const saved_game_point_names = Object.getOwnPropertyNames(
      saved_game.points,
    );
    if (
      saved_game_point_names.length === client.room.allLocations.length &&
      saved_game_point_names.every((v) =>
        client.room.allLocations.includes(parseInt(v, 10)),
      ) &&
      Array.isArray(saved_game.home) &&
      saved_game.home.length === 2 &&
      prefs.home &&
      coordinatesApproximatelyEqual(saved_game.home, prefs.home)
    ) {
      game_data.points.clear();
      for (const location_id_str in saved_game.points) {
        game_data.points.set(
          parseInt(location_id_str, 10),
          saved_game.points[location_id_str],
        );
      }
      // We're connecting to the same game we're loading, and were able to load all trip points, so
      // signal that we don't need to regenerate points.
      return true;
    }
  }

  // We're connecting to the same game, but either the home location has changed or we couldn't load
  // trip points, so we do need to regenerate them.
  return false;
}

export function ensureLocationsScouted(locations: number[]) {
  if (!slot_data) {
    // Haven't loaded the saved game yet
    return;
  }
  // Ensure that we can display the item from checked locations.
  // During normal gameplay, scouted_locations is updated as we get near, but it's possible for
  // the scouting circle to be smaller than the collection circle, or for another client to have
  // collected the location before we did.
  const unscouted_locations = locations.filter(
    (location_id) => !game_data.scouted_locations.has(location_id),
  );
  if (unscouted_locations.length > 0) {
    console.log("Scouting checked locations:", unscouted_locations);
    client.scout(unscouted_locations);
  }
}

export function setUpGameplay() {
  const trap_dialog = document.getElementById(
    "trap-dialog",
  ) as HTMLDialogElement | null;
  trap_dialog?.addEventListener("click", () => {
    trap_dialog.close();
  });
  trap_dialog?.addEventListener("close", () => {
    game_data.last_displayed_dialog_trap = Math.max(
      game_data.last_displayed_dialog_trap,
      displaying_dialog_trap,
    );
    saveGame();
    const item = dialog_trap_queue.pop();
    if (item) {
      displayDialogTrap(item);
    }
  });
  client.items.on("itemsReceived", receiveItems);
  client.room.on("locationsChecked", ensureLocationsScouted);
  client.socket.on("locationInfo", (location_info) => {
    location_info.locations.forEach((item) => {
      game_data.scouted_locations.set(item.location, item);
    });
    saveGame();
  });
  silence = preloadSound("sfx/silence.wav", 1);
  client.socket.on("disconnected", () => {
    timed_trap_timers.forEach(([_start_time, _start_item_index, timer]) => {
      window.clearTimeout(timer);
    });
    timed_trap_timers.clear();
    setFogOfWarVisible(false);
    stopSilenceTrap();
  });
}

function stopSilenceTrap() {
  silence?.pause();
  setMuted(false);
}

function timedTrap(item: Item, start_trap: () => void, stop_trap: () => void) {
  if (!slot_data) {
    // If slot_data is undefined, we haven't loaded a game yet, so we don't know which traps have
    // been displayed, so hold off from displaying any traps until after loading.
    return;
  }

  const this_item_index = client.items.received.indexOf(item);
  if (this_item_index === -1) {
    throw "Tried to set a trap that hasn't been received";
  }

  const end_and_update = () => {
    stop_trap();
    // in case this item was queued and we kept the old start_item_index, we need to update the map
    // with the latest index so that it isn't displayed again
    timed_trap_timers.set(item.id, [0, this_item_index, -1]);
    saveGame();
  };

  let timeout: number;
  let new_start_time: number;
  let new_item_index: number;

  // check if there's a currently active timer
  const timer_data = timed_trap_timers.get(item.id);
  if (timer_data === undefined) {
    console.log("Timed trap", item.id, "with no existing timer");
    timeout = prefs.trap_duration * 1000;
    new_start_time = Date.now();
    new_item_index = this_item_index;
  } else {
    const [start_time, start_item_index, old_timer] = timer_data;
    new_start_time = start_time;
    new_item_index = start_item_index;

    // check that this one is new
    if (this_item_index < start_item_index) {
      // e.g. during reconnection, and receiveItem is called for everything we've received
      // previously, don't re-show traps that already expired before the current one in
      // timed_trap_timers
      return;
    } else if (this_item_index === start_item_index) {
      // re-receiving the item we already have a start time for
      console.log(
        "Timed trap",
        item.id,
        "previously started at",
        new Date(start_time),
      );
      const new_end_time = start_time + prefs.trap_duration * 1000;
      timeout = new_end_time - Date.now();
      if (timeout <= 0) {
        // it already expired, don't start a timer
        return;
      }
    } else {
      // newly received trap, check whether to start new or queue
      console.log(
        "Timed trap",
        item.id,
        "at index",
        start_item_index,
        "previously started at",
        new Date(start_time),
      );
      const number_of_times_this_trap_should_have_been_displayed_previously =
        client.items.received
          .slice(start_item_index, this_item_index)
          .filter((received_item) => received_item.id === item.id).length;
      const end_time_for_the_last_trap =
        start_time +
        number_of_times_this_trap_should_have_been_displayed_previously *
          prefs.trap_duration *
          1000;

      // check whether the timer would have expired by now
      if (end_time_for_the_last_trap < Date.now()) {
        // the previous trap has expired, so start a new timer
        timeout = prefs.trap_duration * 1000;
        new_start_time = Date.now();
        new_item_index = this_item_index;
      } else {
        // it hasn't expired, so extend it
        const total_number_of_times_this_trap_should_be_displayed =
          number_of_times_this_trap_should_have_been_displayed_previously + 1;
        const new_end_time =
          start_time +
          prefs.trap_duration *
            1000 *
            total_number_of_times_this_trap_should_be_displayed;
        timeout = new_end_time - Date.now();
      }
    }

    if (old_timer !== -1) {
      window.clearTimeout(old_timer);
    }
  }

  start_trap();
  console.log("Timing trap", item.id, "for", timeout, "more ms");
  const timer = window.setTimeout(end_and_update, timeout);
  timed_trap_timers.set(item.id, [new_start_time, new_item_index, timer]);
  saveGame();
}

export function receiveItems(items: Item[]) {
  items.forEach((item) => {
    switch (item.id as ItemType) {
      case ItemType.DistanceReduction:
        console.error("DistanceReduction unimplemented"); // TODO
        break;
      case ItemType.Key:
      case ItemType.ScoutingDistance:
      case ItemType.CollectionDistance:
        checkLastKnownLocation();
        break;

      case ItemType.ShuffleTrap:
        console.error("ShuffleTrap unimplemented"); // TODO
        // "Moves some locations around the map, or swaps some locations with each other."
        break;
      case ItemType.SilenceTrap:
        timedTrap(
          item,
          () => {
            // TODO: Experiment with audio session types, see which one works to pause music for this
            // long a duration
            if (silence) playSound(silence, "transient-solo", true);
            setMuted(true);
          },
          stopSilenceTrap,
        );
        break;
      case ItemType.FogOfWarTrap:
        timedTrap(
          item,
          () => {
            setFogOfWarVisible(true);
          },
          () => {
            setFogOfWarVisible(false);
          },
        );
        break;

      case ItemType.PushUpTrap:
      case ItemType.SocializingTrap:
      case ItemType.SitUpTrap:
      case ItemType.JumpingJackTrap:
      case ItemType.TouchGrassTrap:
        displayDialogTrap(item);
        break;

      case ItemType.MacguffinA:
      case ItemType.MacguffinR:
      case ItemType.MacguffinC:
      case ItemType.MacguffinH:
      case ItemType.MacguffinI:
      case ItemType.MacguffinP:
      case ItemType.MacguffinE:
      case ItemType.MacguffinL:
      case ItemType.MacguffinA2:
      case ItemType.MacguffinHyphen:
      case ItemType.MacguffinG:
      case ItemType.MacguffinO:
      case ItemType.MacguffinExclamation:
        if (
          slot_data?.goal === Goal.ShortMacGuffin ||
          slot_data?.goal === Goal.LongMacGuffin
        ) {
          const required_items =
            slot_data?.goal === Goal.ShortMacGuffin
              ? SHORT_MACGUFFIN_ITEMS
              : LONG_MACGUFFIN_ITEMS;
          if (
            required_items.every((item_id) =>
              client.items.received.some((item) => item.id === item_id),
            )
          ) {
            client.goal();
          }
        }
        break;

      case ItemType.Hydrate:
      case ItemType.TakeBreather:
        displayDialogTrap(item);
        break;

      default:
        console.error(`Unknown item type ${item}`);
        break;
    }
  });
}

function hasDisplayedDialogTrap(item: Item): boolean {
  // If slot_data is undefined, we haven't loaded a game yet, so we don't know which traps have
  // been displayed, so hold off from displaying any traps until after loading.
  return (
    !slot_data ||
    client.items.received.indexOf(item) <= game_data.last_displayed_dialog_trap
  );
}

function displayDialogTrap(item: Item) {
  if (hasDisplayedDialogTrap(item)) {
    return;
  }
  if (
    document
      .querySelector("#text-overlay > *")
      ?.getAnimations()
      .some((a) => a.playState === "running")
  ) {
    // HACK: Dialog elements always layer on top of everything, including the victory animation. I
    // don't want the user to miss the victory animation because of a trap that auto-released. So if
    // the animation is playing, don't display any traps.
    dialog_trap_queue.push(item);
    return;
  }

  const trap_dialog = document.getElementById(
    "trap-dialog",
  ) as HTMLDialogElement | null;
  if (!trap_dialog) {
    throw "Can't find trap dialog";
  }

  if (trap_dialog.open) {
    dialog_trap_queue.push(item);
    return;
  }

  const header = trap_dialog.querySelector("h2");
  if (header?.firstChild) {
    (header?.firstChild as Text).data = item.name;
  } else {
    header?.appendChild(document.createTextNode(item.name));
  }

  let img_src: string | null = null;
  switch (item.id as ItemType) {
    case ItemType.PushUpTrap:
      img_src = "items/push-up.svg";
      break;
    case ItemType.SocializingTrap:
      img_src = "items/socializing.svg";
      break;
    case ItemType.SitUpTrap:
      img_src = "items/sit-up.svg";
      break;
    case ItemType.JumpingJackTrap:
      img_src = "items/jumping-jack.svg";
      break;
    case ItemType.TouchGrassTrap:
      img_src = "items/touch-grass.svg";
      break;
    case ItemType.Hydrate:
      img_src = "items/water_bottle.svg";
      break;
    case ItemType.TakeBreather:
      img_src = "items/tree_and_bench_with_backrest.svg";
      break;
  }
  if (img_src) {
    trap_dialog.querySelector("img")?.setAttribute("src", img_src);
  }

  displaying_dialog_trap = client.items.received.indexOf(item);

  trap_dialog.showModal();
}

export function moveGameState(new_state: GameState) {
  console.log("Moving to game state:", new_state);
  switch (new_state) {
    case GameState.Disconnected:
      // from: connection screen connection error, socket callback
      setFormDisabled(false);
      setConnectDisabled(false);
      setConnectText(true);
      if (window.location.hash !== "#connect") {
        window.location.hash = "#connect";
      }
      stopTracking();
      game_data.points.clear();
      clearMarkers();
      break;
    case GameState.Connecting:
      // from: connection screen
      setFormDisabled(true);
      setConnectDisabled(true);
      setConnectText(true);
      setConnectionMessage(
        i18next.t("connect.message.connecting", "Connecting…"),
      );
      break;
    case GameState.Generating:
      // from: connection screen, if no game saved
      setConnectionMessage(
        i18next.t("connect.message.generating", "Generating…"),
      );
      break;
    case GameState.ReadyNotTracking:
      // from: connection screen
      client.updateStatus(clientStatuses.ready);
      setConnectDisabled(false);
      setConnectText(false);
      break;
    case GameState.Tracking:
      // from: GPS
      client.updateStatus(clientStatuses.playing);
      if (window.location.hash === "#map") {
        // acquire wake lock
        showMapPage();
      }
      break;

    default:
      throw `Invalid game state: ${game_state}, ${new_state}`;
  }
  if (new_state !== GameState.Tracking && window.location.hash === "#map") {
    // release wake lock
    hideMapPage();
  }
  setGameState(new_state);
}
