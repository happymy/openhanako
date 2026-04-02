// plugins/image-gen/index.js
import { AdapterRegistry } from "./lib/adapter-registry.js";
import { volcengineImageAdapter } from "./adapters/volcengine.js";
import { openaiImageAdapter } from "./adapters/openai.js";

export default class ImageGenPlugin {
  async onload() {
    this.registry = new AdapterRegistry();
    this.registry.register(volcengineImageAdapter);
    // volcengine-coding shares the same adapter logic
    this.registry.register({ ...volcengineImageAdapter, id: "volcengine-coding" });
    this.registry.register(openaiImageAdapter);
  }
}
