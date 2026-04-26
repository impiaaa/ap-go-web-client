import { LngLat, LngLatBounds } from "maplibre-gl";
import { client, prefs, slot_data } from "./globals";

// TODO: timeout is also used in prioritization
const query = `[out:json][timeout:180][maxsize:{{maxsize}}][bbox:{{bbox}}];
(
  (
    way[highway=footway](around:{{maximum_distance}},{{center}});
    way[highway=living_street](around:{{maximum_distance}},{{center}});
    way[highway=path](around:{{maximum_distance}},{{center}});
    way[highway=pedestrian](around:{{maximum_distance}},{{center}});
    way[highway=platform](around:{{maximum_distance}},{{center}});
    way[highway=primary](around:{{maximum_distance}},{{center}});
    way[highway=primary_link](around:{{maximum_distance}},{{center}});
    way[highway=residential](around:{{maximum_distance}},{{center}});
    way[highway=secondary](around:{{maximum_distance}},{{center}});
    way[highway=secondary_link](around:{{maximum_distance}},{{center}});
    way[highway=service](around:{{maximum_distance}},{{center}});
    way[highway=steps](around:{{maximum_distance}},{{center}});
    way[highway=tertiary](around:{{maximum_distance}},{{center}});
    way[highway=tertiary_link](around:{{maximum_distance}},{{center}});
    way[highway=track](around:{{maximum_distance}},{{center}});
    way[highway=unclassified](around:{{maximum_distance}},{{center}});
    way[leisure=track](around:{{maximum_distance}},{{center}});
    way[man_made=pier](around:{{maximum_distance}},{{center}});
    way[railway=platform](around:{{maximum_distance}},{{center}});
  );
  -
  (
    way[access=no](around:{{maximum_distance}},{{center}});
    way[access=agricultural](around:{{maximum_distance}},{{center}});
    way[access=forestry](around:{{maximum_distance}},{{center}});
    way[access=private](around:{{maximum_distance}},{{center}});
    way[access=delivery](around:{{maximum_distance}},{{center}});
    way[access=use_sidepath](around:{{maximum_distance}},{{center}});
    way[foot=no](around:{{maximum_distance}},{{center}});
    way[foot=agricultural](around:{{maximum_distance}},{{center}});
    way[foot=forestry](around:{{maximum_distance}},{{center}});
    way[foot=private](around:{{maximum_distance}},{{center}});
    way[foot=delivery](around:{{maximum_distance}},{{center}});
    way[foot=use_sidepath](around:{{maximum_distance}},{{center}});
    way[sidewalk=separate](around:{{maximum_distance}},{{center}});
  );
);
(
  ._;
  way[highway][foot=designated](around:{{maximum_distance}},{{center}});
  way[highway][foot=yes](around:{{maximum_distance}},{{center}});
  way[highway][foot=permissive](around:{{maximum_distance}},{{center}});
);
(
  ._;
  >;
);
out skel qt;`;

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
  // it will require. In my experimenting, 890112 bytes are required to run the default query with
  // radius=1000m in Manhattan, a road-dense city. That radius makes an area of ~3.14e6m², so ~0.283
  // bytes/m². Then add a fudge factor of 1.5x to approximate the memory required per area.
  const maxsize = Math.round(
    slot_data.maximum_distance *
      slot_data.maximum_distance *
      Math.PI *
      0.424997174,
  );
  const my_query = query
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
        if (req.responseText[0] === "{") {
          const res = JSON.parse(req.responseText);
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
        } else {
          reject(`Overpass error: ${req.responseText}`);
        }
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
  req.open("POST", prefs.overpass_server, true);
  console.log("Sending Overpass request");
  req.send(`data=${encodeURIComponent(my_query)}`);
  return ret;
}
