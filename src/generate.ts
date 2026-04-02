import { home, slot_data } from "./globals";

export const EARTH_RADIUS_M = 6371008.7714;
// 1° latitude in meters
export const DEGREE = (EARTH_RADIUS_M * 2 * Math.PI) / 360;

/*
const query = `
[out:json][timeout:60];
(
  way[highway=primary](around:{{around}});
  way[highway=primary_link](around:{{around}});
  way[highway=secondary](around:{{around}});
  way[highway=secondary_link](around:{{around}});
  way[highway=tertiary](around:{{around}});
  way[highway=tertiary_link](around:{{around}});
  way[highway=unclassified](around:{{around}});
  way[highway=residential](around:{{around}});
  way[highway=living_street](around:{{around}});
  way[highway=service](around:{{around}});
  way[highway=track](around:{{around}});
  way[highway=path](around:{{around}});
  way[highway=steps](around:{{around}});
  way[highway=pedestrian](around:{{around}});
  way[highway=platform](around:{{around}});
  way[highway=footway](around:{{around}});
  way[highway=pier](around:{{around}});
  way[railway=platform](around:{{around}});
  way[amenity=parking](around:{{around}});
  way[man_made=pier](around:{{around}});
  way[leisure=track](around:{{around}});
);
(._; >;);
out body;`
const overpass_server = "https://overpass.private.coffee/api/interpreter";*/

export function generate(_seed: number) {
  if (!home) {
    throw "generate called with no home set";
  }
  if (!slot_data) {
    throw "generate called while not connected";
  }

  /*const my_query = query.replaceAll("{{around}}", `${10},${home[1]},${home[0]}`); // slot_data.maximum_distance
  const req = new XMLHttpRequest();
  req.addEventListener("load", function() {
    if (this.responseText[0] === '{') {
      const res = JSON.parse(this.responseText);
      const worker = new Worker(new URL("./worker.ts", import.meta.url));
      worker.onmessage = (event) => {
        console.log('The results from Workers:', event.data);
      };
      worker.postMessage(res);
    }
    else {
      // TODO: show error
      console.log(this.responseText);
    }
  });
  req.open("POST", overpass_server, true);
  req.send(`data=${encodeURIComponent(my_query)}`);*/
  const url = new URL("@pkgs/gen", import.meta.url);
      const worker = new Worker(url);
      worker.onmessage = (event) => {
        console.log('The results from Workers:', event.data);
      };
      worker.postMessage({elements: [{type: "node"}]});
}
