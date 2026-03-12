import maplibregl from "maplibre-gl";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import type { RandomGenerator } from "pure-rand/types/RandomGenerator";
import { clearPoints, client, home, points, slot_data } from "./globals";
import { game_map, updateMarker } from "./map";

export const EARTH_RADIUS_M = 6371008.7714;
// 1° latitude in meters
export const DEGREE = (EARTH_RADIUS_M * 2 * Math.PI) / 360;
const DISTANCE_LENIENCY = 0.1;

const divisor = 1 << 24;
const scale = 1 / divisor;
const mask = divisor - 1;

function uniformFloat32(rng: RandomGenerator): number {
  const value = rng.next() & mask;
  return value * scale;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export function generate(seed: number) {
  if (!home) {
    throw "generate called with no home set";
  }
  if (!slot_data) {
    throw "generate called while not connected";
  }
  const rng = xoroshiro128plus(seed);
  const bounds = new maplibregl.LngLatBounds();
  clearPoints();
  for (const trip_name in slot_data.trips) {
    const trip = slot_data.trips[trip_name];
    let max_dist = (slot_data.maximum_distance / 10) * trip.distance_tier;
    let min_dist = slot_data.minimum_distance;
    if (max_dist < slot_data.minimum_distance) {
      max_dist = slot_data.minimum_distance * (1 + DISTANCE_LENIENCY);
    }
    if (min_dist > slot_data.maximum_distance) {
      min_dist = slot_data.maximum_distance * (1 - DISTANCE_LENIENCY);
    }

    const r = (max_dist - min_dist) * uniformFloat32(rng) ** 0.5 + min_dist;
    const theta = uniformFloat32(rng) * Math.PI * 2;
    const dy = r * Math.sin(theta);
    const dx = r * Math.cos(theta);

    const new_latitude = home[1] + dy / DEGREE;
    const new_longitude =
      home[0] + dx / (DEGREE * Math.cos(deg2rad(new_latitude)));

    const lnglat: [number, number] = [new_longitude, new_latitude];
    bounds.extend(lnglat);
    const location_id = client.room.allLocations.find(
      (loc_id) =>
        client.package.lookupLocationName(client.game, loc_id) === trip_name,
    );
    if (location_id) {
      points[location_id] = lnglat;
    } else {
      console.error(`Trip ${trip_name} has no matching location!`);
    }
  }
  if (game_map) {
    game_map.fitBounds(bounds, {
      animate: false,
      // ensure tops and sides of markers are visible
      padding: { left: 14, right: 14, top: 36, bottom: 0 },
    });
  }

  client.room.allLocations.forEach((location_id) => {
    updateMarker(location_id);
  });
}
