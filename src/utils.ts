import type { Item } from "archipelago.js";
import { LngLat, type LngLatLike } from "maplibre-gl";

function metersAtEquatorToDegrees(m: number): number {
  const earthCircumferenceInMetersAtEquator = 40075017;
  return (360 * m) / earthCircumferenceInMetersAtEquator;
}

export function roundCoordinates(
  c: LngLatLike,
  accuracy: number = 100,
): [number, number] {
  const spacing = metersAtEquatorToDegrees(accuracy);
  const { lng, lat } = LngLat.convert(c);
  return [
    Math.round(lng / spacing) * spacing,
    Math.round(lat / spacing) * spacing,
  ];
}

export function coordinatesApproximatelyEqual(
  c1: LngLatLike,
  c2: LngLatLike,
  accuracy: number = 100,
): boolean {
  const spacing = metersAtEquatorToDegrees(accuracy);
  const l1 = LngLat.convert(c1);
  const l2 = LngLat.convert(c2);
  return (
    Math.abs(l1.lng - l2.lng) < spacing && Math.abs(l1.lat - l2.lat) < spacing
  );
}

export function styleItemElement(element: HTMLElement, item: Item) {
  if (item.progression) element.classList.add("progression");
  if (item.useful) element.classList.add("useful");
  if (item.trap) element.classList.add("trap");
}
