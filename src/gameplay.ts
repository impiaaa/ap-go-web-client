import { LngLat } from 'maplibre-gl';
import { client, points } from './globals';
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

export function checkItems(coords: GeolocationCoordinates) {
  const scoutingDistance = getScoutingDistance();
  const collectionDistance = getCollectionDistance();
  const my_lnglat = new LngLat(coords.longitude, coords.latitude);
  const scouts: number[] = [];
  const checks: number[] = [];

  points.forEach((point, location_id) => {
    const dist = LngLat.convert(point).distanceTo(my_lnglat);
    if (dist < scoutingDistance) {
      scouts.push(location_id);
    }
    if (dist < collectionDistance) {
      checks.push(location_id);
    }
  });

  if (scouts.length > 0) {
    client.scout(scouts).then((items) => {
      items.forEach((item) => {
        updateMarker(item);
      });
    });
  }
  if (checks.length > 0) {
    client.check(...checks);
  }
}
