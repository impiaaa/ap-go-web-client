self.onmessage = (event) => {
    const elements: any[] = event.data.elements;
    const nodes = elements.filter((e) => e.type === "node");
    postMessage([nodes[0], typeof self]);
}