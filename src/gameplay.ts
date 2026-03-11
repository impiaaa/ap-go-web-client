import { LngLat } from 'maplibre-gl';
import {
  client,
  points,
  SAVED_GAME_KEY,
  scouted_locations,
  slot_data,
} from './globals';
import { updateMarker } from './map';
import { ItemType } from './types';

const SCOUTING_DISTANCE_BASE = 30;
const SCOUTING_DISTANCE_INCREMENT = 10;
const COLLECTION_DISTANCE_BASE = 20;
const COLLECTION_DISTANCE_INCREMENT = 10;

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

export function checkLocations(coords: LngLat) {
  const scoutingDistance = getScoutingDistance();
  const collectionDistance = getCollectionDistance();
  const key_progression = getKeyProgress();
  const scouts: number[] = [];
  const checks: number[] = [];

  for (const location_id_str in points) {
    const location_id = parseInt(location_id_str);
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
      if (trip && key_progression >= trip.key_needed) {
        checks.push(location_id);
      }
    }
  }

  if (scouts.length > 0) {
    console.log(`Scouting locations: ${scouts}`);
    client.scout(scouts).then((items) => {
      items.forEach((item) => {
        scouted_locations[item.locationId] = {
          item: item.id,
          location: item.locationId,
          player: item.receiver.slot,
          flags: item.flags,
        };
        updateMarker(item);
      });
      console.log(items);
      console.log(scouted_locations);
      localStorage.setItem(
        SAVED_GAME_KEY,
        JSON.stringify({
          seed: client.room.seedName,
          scouted_locations: scouted_locations,
        }),
      );
    });
  }
  if (checks.length > 0) {
    console.log(`Checking locations: ${checks}`);
    // TODO: receive items
    //client.check(...checks);
  }
}
