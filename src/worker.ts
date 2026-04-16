import init, { generate } from "@pkgs/gen";

self.onmessage = (event) => {
  init().then(() => {
    postMessage(generate(event.data));
  });
};
