import { clientStatuses, type Item } from "archipelago.js";
import { LngLat } from "maplibre-gl";
import {
  COLLECTION_DISTANCE_BASE,
  COLLECTION_DISTANCE_INCREMENT,
  client,
  LONG_MACGUFFIN_ITEMS,
  points,
  SAVED_GAME_KEY,
  SCOUTING_DISTANCE_BASE,
  SCOUTING_DISTANCE_INCREMENT,
  SHORT_MACGUFFIN_ITEMS,
  scouted_locations,
  slot_data,
} from "./globals";
import { updateMarker } from "./map";
import { Goal, ItemType } from "./types";

export function getKeyProgress(): number {
  return client.items.received.filter((item) => item.id === ItemType.Key)
    .length;
}

export function getScoutingDistance(): number {
  return (
    client.items.received.filter(
      (item) => item.id === ItemType.ScoutingDistance,
    ).length *
      SCOUTING_DISTANCE_INCREMENT +
    SCOUTING_DISTANCE_BASE
  );
}

export function getCollectionDistance(): number {
  return (
    client.items.received.filter(
      (item) => item.id === ItemType.CollectionDistance,
    ).length *
      COLLECTION_DISTANCE_INCREMENT +
    COLLECTION_DISTANCE_BASE
  );
}

let last_known_location: LngLat | undefined;

function checkLastKnownLocation() {
  if (last_known_location) {
    checkLocations(last_known_location);
  }
}

export function checkLocations(coords: LngLat) {
  last_known_location = coords;
  const scoutingDistance = getScoutingDistance();
  const collectionDistance = getCollectionDistance();
  const key_progression = getKeyProgress();
  const scouts: number[] = [];
  const checks: number[] = [];

  for (const location_id_str in points) {
    const location_id = parseInt(location_id_str, 10);
    const point = points[location_id];
    const dist = LngLat.convert(point).distanceTo(coords);
    if (dist < scoutingDistance && !scouted_locations[location_id]) {
      scouts.push(location_id);
    }
    if (dist < collectionDistance) {
      const location_name = client.package.lookupLocationName(
        client.game,
        location_id,
      );
      const trip = slot_data?.trips[location_name];
      const checked = client.room.checkedLocations.includes(location_id);
      if (!checked && trip && key_progression >= trip.key_needed) {
        checks.push(location_id);
      }
    }
  }

  if (scouts.length > 0) {
    console.log(`Scouting locations: ${scouts}`);
    client.scout(scouts).then((items) => {
      items.forEach((item) => {
        scouted_locations[item.locationId] = {
          flags: item.flags,
          item: item.id,
          location: item.locationId,
          player: item.receiver.slot,
        };
        updateMarker(item);
      });
      localStorage.setItem(
        SAVED_GAME_KEY,
        JSON.stringify({
          scouted_locations: scouted_locations,
          seed: client.room.seedName,
        }),
      );
    });
  }
  if (checks.length > 0) {
    console.log(`Checking locations: ${checks}`);
    client.check(...checks);
  }
}

export function setUpGameplay() {
  client.items.on("itemsReceived", receiveItems);
  const trap_dialog = document.getElementById(
    "trap-dialog",
  ) as HTMLDialogElement | null;
  trap_dialog?.addEventListener("click", () => {
    trap_dialog.close();
  });
  client.socket.on("roomUpdate", (ev) => {
    if (ev.checked_locations !== undefined) {
      ev.checked_locations.forEach((location_id) => {
        updateMarker(location_id);
      });
    }
  });
}

function receiveItems(items: Item[]) {
  items.forEach((item) => {
    switch (item.id as ItemType) {
      case ItemType.DistanceReduction:
        // TODO
        console.error("DistanceReduction item unimplemented");
        break;
      case ItemType.Key: {
        const key_progression = getKeyProgress();
        client.room.missingLocations.forEach((location_id) => {
          const location_name = client.package.lookupLocationName(
            client.game,
            location_id,
          );
          const trip = slot_data?.trips[location_name];
          if (trip && key_progression >= trip.key_needed) {
            updateMarker(location_id);
          }
        });
        checkLastKnownLocation();
        break;
      }
      case ItemType.ScoutingDistance:
      case ItemType.CollectionDistance:
        checkLastKnownLocation();
        break;

      case ItemType.ShuffleTrap:
        // TODO
        console.error("ShuffleTrap item unimplemented");
        break;
      case ItemType.SilenceTrap:
        // TODO
        console.error("SilenceTrap item unimplemented");
        break;
      case ItemType.FogOfWarTrap:
        // TODO
        console.error("FogOfWarTrap item unimplemented");
        break;

      case ItemType.PushUpTrap:
      case ItemType.SocializingTrap:
      case ItemType.SitUpTrap:
      case ItemType.JumpingJackTrap:
      case ItemType.TouchGrassTrap:
        displayTrap(item);
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
            client.updateStatus(clientStatuses.goal);
          }
        }
        break;

      case ItemType.Hydrate:
      case ItemType.TakeBreather:
        displayTrap(item);
        break;

      default:
        console.error(`Unknown item type ${item}`);
        break;
    }
    if (item.sender.slot === client.players.self.slot) {
      updateMarker(item, true);
    }
  });
}

function displayTrap(item: Item) {
  const trap_dialog = document.getElementById(
    "trap-dialog",
  ) as HTMLDialogElement | null;
  if (!trap_dialog) {
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

  trap_dialog.showModal();
}
