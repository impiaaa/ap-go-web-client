import { LngLat, LngLatBounds } from "maplibre-gl";
import { client, prefs, slot_data } from "./globals";

export function generate(seed_name: string, slot: number) {
  if (!prefs.home) {
    throw "generate called with no home set";
  }
  if (!slot_data) {
    throw "generate called while not connected";
  }

  // Query optimization: BBox searches are faster than within-radius.
  const bbox = LngLatBounds.fromLngLat(
    LngLat.convert(prefs.home),
    slot_data.maximum_distance,
  );
  // Query optimization: We can get our query to be prioritized better by estimating how much memory
  // it will require. In my experimenting, 55581746 bytes are required to run the default query with
  // radius=5000m in London. That radius makes an area of 7.85e7 m², so ~0.708 bytes/m². Then add a
  // fudge factor of 2x to approximate the memory required per area.
  const maxsize = Math.round(
    slot_data.maximum_distance *
      slot_data.maximum_distance *
      Math.PI *
      1.415377539,
  );
  const my_query = prefs.overpass_query
    .replaceAll("{{maximum_distance}}", `${slot_data.maximum_distance}`)
    .replaceAll("{{center}}", `${prefs.home[1]},${prefs.home[0]}`)
    .replaceAll(
      "{{bbox}}",
      `${bbox.getSouth()},${bbox.getWest()},${bbox.getNorth()},${bbox.getEast()}`,
    )
    .replaceAll("{{maxsize}}", `${maxsize}`);
  const req = new XMLHttpRequest();
  const ret = new Promise<Map<number, Array<number>> | string>(
    (resolve, reject) => {
      req.addEventListener("load", () => {
        if (req.responseText[0] !== "{") {
          reject(`Overpass error: ${req.responseText}`);
          return;
        }
        const res = JSON.parse(req.responseText);
        if (
          (res.elements === undefined ||
            (Array.isArray(res.elements) && res.elements.length === 0)) &&
          res.remark
        ) {
          reject(`Overpass error: ${res.remark}`);
          return;
        }
        const worker = new Worker(new URL("./worker.ts", import.meta.url));
        worker.onmessage = (event) => {
          resolve(event.data);
        };
        worker.postMessage({
          home: prefs.home,
          locations: new Map<number, string>(
            client.room.allLocations.map((location_id) => [
              location_id,
              client.package.lookupLocationName(client.game, location_id),
            ]),
          ),
          osm: res,
          seed_name: seed_name,
          slot: slot,
          slot_data: slot_data,
        });
      });
      req.addEventListener("abort", () => {
        reject("Request aborted");
      });
      req.addEventListener("error", () => {
        reject(
          req.status === 200
            ? "Unknown network error"
            : `HTTP error ${req.status}: ${req.statusText}`,
        );
      });
    },
  );
  //req.open("POST", prefs.overpass_server, true);
  req.open("POST", "/testdata.json", true);
  console.log("Sending Overpass request");
  req.send(`data=${encodeURIComponent(my_query)}`);
  return ret;
}
