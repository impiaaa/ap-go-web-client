import init, { generate } from "@pkgs/gen";

self.onmessage = (event) => {
  init().then(() => {
    let result: Map<number, Array<number>> | string;
    try {
      result = generate(event.data);
    } catch (error) {
      if (typeof error === "string") {
        result = error;
      } else {
        throw error;
      }
    }
    postMessage(result);
  });
};
