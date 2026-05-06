import type { GenerateParams } from "@pkgs/gen";
import init, { generate } from "@pkgs/gen";

self.onmessage = (event: MessageEvent<GenerateParams>) => {
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
