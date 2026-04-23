import { LngLat, LngLatBounds } from "maplibre-gl";
import { client, home, slot_data } from "./globals";

const query = `[out:json][timeout:180][maxsize:{{maxsize}}][bbox:{{bbox}}];
(
  (
    way[highway=footway](around:{{around}});
    way[highway=living_street](around:{{around}});
    way[highway=path](around:{{around}});
    way[highway=pedestrian](around:{{around}});
    way[highway=platform](around:{{around}});
    way[highway=primary](around:{{around}});
    way[highway=primary_link](around:{{around}});
    way[highway=residential](around:{{around}});
    way[highway=secondary](around:{{around}});
    way[highway=secondary_link](around:{{around}});
    way[highway=service](around:{{around}});
    way[highway=steps](around:{{around}});
    way[highway=tertiary](around:{{around}});
    way[highway=tertiary_link](around:{{around}});
    way[highway=track](around:{{around}});
    way[highway=unclassified](around:{{around}});
    way[leisure=track](around:{{around}});
    way[man_made=pier](around:{{around}});
    way[railway=platform](around:{{around}});
  );
  -
  (
    way[access=no](around:{{around}});
    way[access=agricultural](around:{{around}});
    way[access=forestry](around:{{around}});
    way[access=private](around:{{around}});
    way[access=delivery](around:{{around}});
    way[access=use_sidepath](around:{{around}});
    way[foot=no](around:{{around}});
    way[foot=agricultural](around:{{around}});
    way[foot=forestry](around:{{around}});
    way[foot=private](around:{{around}});
    way[foot=delivery](around:{{around}});
    way[foot=use_sidepath](around:{{around}});
    way[sidewalk=separate](around:{{around}});
  );
);
(
  ._;
  way[highway][foot=designated](around:{{around}});
  way[highway][foot=yes](around:{{around}});
  way[highway][foot=permissive](around:{{around}});
);
(
  ._;
  >;
);
out skel qt;`;
const overpass_server = "https://overpass.private.coffee/api/interpreter";

export function generate(seed_name: string, slot: number) {
  if (!home) {
    throw "generate called with no home set";
  }
  if (!slot_data) {
    throw "generate called while not connected";
  }

  // Query optimization: BBox searches are faster than within-radius.
  const bbox = LngLatBounds.fromLngLat(
    LngLat.convert(home),
    slot_data.maximum_distance,
  );
  // Query optimization: We can get our query to be prioritized better by estimating how much memory
  // it will require. In my experimenting, 7338127 bytes are required to run the default query with
  // radius=5585m around Giza, apparently the densest city in the world. That radius makes an area
  // of ~9.8e7m², so ~0.075 bytes/m². Then add a fudge factor of 1.5x to approximate the memory
  // required per area.
  const maxsize = Math.round(
    slot_data.maximum_distance *
      slot_data.maximum_distance *
      Math.PI *
      0.11232599,
  );
  const my_query = query
    .replaceAll(
      "{{around}}",
      `${slot_data.maximum_distance},${home[1]},${home[0]}`,
    )
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
            home: home,
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
  req.open("POST", overpass_server, true);
  req.send(`data=${encodeURIComponent(my_query)}`);
  return ret;
}
