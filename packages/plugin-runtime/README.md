# @hana/plugin-runtime

Node-side helper package for Hana plugins.

This package is intentionally small. It gives plugin authors stable shapes and TypeScript types while preserving Hana's current plugin loading model.

```ts
import { definePlugin, defineTool } from '@hana/plugin-runtime';

export const searchTool = defineTool({
  name: 'search',
  description: 'Search project data',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    ctx.log.info('searching', input);
    return `results for ${input.query}`;
  },
});

export default definePlugin({
  async onload(ctx, { register }) {
    if (ctx.registerTool) {
      register(ctx.registerTool(searchTool));
    }
  },
});
```

Static `tools/*.js` and `commands/*.js` still use Hana's named export loader today. Lifecycle plugins can already use `export default definePlugin(...)` because the host expects a default class-compatible value.
