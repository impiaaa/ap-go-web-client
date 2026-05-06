import { GenerateParams } from "@pkgs/gen/gen";
import i18next from "i18next";
import { LngLat, LngLatBounds } from "maplibre-gl";
import { client, prefs, slot_data } from "./globals";

export function generate(seed_name: string, slot: number) {
  if (!prefs.home) {
    throw "generate called with no home set";
  }
  if (!slot_data) {
    throw "generate called while not connected";
  }

  // Query optimization: We can get our query to be prioritized better by estimating how long it
  // will take. The most highway-dense 1000m radius circle area in OSM is centered around Soho
  // Square in London. In my experimenting, the current default query takes 10 seconds to run in
  // this area. That radius makes an area of 3.14e6 m², so ~3.18e-6 seconds/m². Then add a fudge
  // factor of 2x to approximate the timeout required per area.
  const timeout = Math.round(
    slot_data.maximum_distance *
      slot_data.maximum_distance *
      Math.PI *
      6.366197724e-6,
  );
  // Query optimization: Same as above, but for memory usage. The same area takes 2121863 bytes to
  // run the current default query, so ~0.675 bytes/m², then add a smaller fudge factor of 1.5x.
  const maxsize = Math.round(
    slot_data.maximum_distance *
      slot_data.maximum_distance *
      Math.PI *
      1.013114955,
  );
  // Query optimization: BBox searches are faster than global within-radius.
  const bbox = LngLatBounds.fromLngLat(
    LngLat.convert(prefs.home),
    slot_data.maximum_distance,
  );
  const my_query = prefs.overpass_query
    .replaceAll("{{timeout}}", `${timeout}`)
    .replaceAll("{{maxsize}}", `${maxsize}`)
    .replaceAll(
      "{{bbox}}",
      `${bbox.getSouth()},${bbox.getWest()},${bbox.getNorth()},${bbox.getEast()}`,
    )
    .replaceAll("{{maximum_distance}}", `${slot_data.maximum_distance}`)
    .replaceAll("{{center}}", `${prefs.home[1]},${prefs.home[0]}`);
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
        worker.postMessage(
          new GenerateParams(
            new Float64Array(prefs.home!),
            new Map<number, string>(
              client.room.allLocations.map((location_id) => [
                location_id,
                client.package.lookupLocationName(client.game, location_id),
              ]),
            ),
            res,
            seed_name,
            slot,
            slot_data,
            prefs.subgraph_selection,
          ),
        );
      });
      req.addEventListener("abort", () => {
        reject(i18next.t("connect.error.aborted", "Request aborted"));
      });
      req.addEventListener("error", () => {
        reject(
          req.status === 200
            ? i18next.t("connect.error.network", "Unknown network error")
            : i18next.t("connect.error.http", {
                defaultValue: "HTTP error {{req.status}}: {{req.statusText}}",
                req: req,
              }),
        );
      });
    },
  );
  req.open("POST", prefs.overpass_server, true);
  //req.open("POST", "/testdata.json", true);
  console.log("Sending Overpass request");
  req.send(`data=${encodeURIComponent(my_query)}`);
  return ret;
}
