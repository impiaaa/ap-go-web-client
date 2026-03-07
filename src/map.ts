import maplibregl from 'maplibre-gl';
import { home } from './globals';

export let game_map: maplibregl.Map | null = null;
let home_marker: maplibregl.Marker | null = null;
export const location_markers: maplibregl.Marker[] = [];

export function createMap(container: string) {
  const darkModeMql = window.matchMedia?.('(prefers-color-scheme: dark)');
  const map = new maplibregl.Map({
    container: container,
    // https://stackoverflow.com/a/57795495
    style: `https://tiles.versatiles.org/assets/styles/${darkModeMql?.matches ? 'eclipse' : 'colorful'}/style.json`,
  });
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (event) => {
      map.setStyle(
        `https://tiles.versatiles.org/assets/styles/${event.matches ? 'eclipse' : 'colorful'}/style.json`,
      );
    });
  return map;
}

export function lateSetUpMap() {
  if (game_map) {
    return;
  }
  game_map = createMap('map');
  setUpHomeMarker();

  if (location_markers.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    location_markers.forEach((marker) => {
      marker.addTo(game_map!);
      bounds.extend(marker.getLngLat());
    });
    game_map?.fitBounds(bounds);
  }
}

export function setUpHomeMarker() {
  if (!home) {
    return;
  }
  if (!game_map) {
    return;
  }
  if (home_marker) {
    home_marker.setLngLat(home);
  } else {
    home_marker = new maplibregl.Marker();
    home_marker.setLngLat(home);
    home_marker.addTo(game_map);
  }
}
