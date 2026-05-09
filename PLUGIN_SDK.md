# Hana Plugin SDK

Hana's plugin SDK is split into small packages so plugin authors can choose only the layer they need.

| Package | Runs In | Purpose |
| --- | --- | --- |
| `@hana/plugin-protocol` | iframe / host | Shared protocol constants and message shapes for plugin UI. |
| `@hana/plugin-sdk` | iframe browser code | Typed helpers for `ready`, resize, toast, external links, clipboard, and lower-level host requests. |
| `@hana/plugin-runtime` | plugin Node runtime | Helpers for tools, lifecycle plugins, EventBus handlers, SessionFile media details, providers, and Pi SDK extensions. |
| `@hana/plugin-components` | iframe React UI | Hana-styled React primitives with theme fallback: controls, cards, rows, lists, and empty states. |

Run `npm run build:packages` after SDK changes. The command builds all SDK packages and their `.d.ts` files:

```bash
npm run build:packages
```

## Runtime Boundary

The SDK packages are developer-facing source/build dependencies. The app package still excludes `packages/**`, so plugin UI code should bundle `@hana/plugin-sdk` and `@hana/plugin-components` into its iframe assets. Runtime helpers from `@hana/plugin-runtime` should be bundled or installed with the plugin when the plugin is distributed outside the monorepo.

Built-in plugins may use the same source patterns, but they should be checked against the packaged server bundle before release. The host does not silently provide these SDK packages as global runtime modules.

## UI Path

Use `@hana/plugin-sdk` for host communication:

```ts
import { hana } from '@hana/plugin-sdk';

hana.ready();
hana.ui.resize({ height: 320 });
await hana.toast.show({ message: 'Ready' });
```

Use `@hana/plugin-components` for iframe UI:

```tsx
import { Button, CardShell, HanaThemeProvider } from '@hana/plugin-components';
import '@hana/plugin-components/styles.css';

export function Panel() {
  return (
    <HanaThemeProvider mode="inherit">
      <CardShell title="Plugin">
        <Button variant="primary">Run</Button>
      </CardShell>
    </HanaThemeProvider>
  );
}
```

Theme fallback order is:

1. Explicit custom tokens passed to `HanaThemeProvider`.
2. Named Hana tokens when `mode="hana"`.
3. Host CSS variables when `mode="inherit"`.
4. SDK defaults in `@hana/plugin-components/styles.css`.

## Runtime Path

Use `@hana/plugin-runtime` for Node-side plugin code:

```js
import { definePlugin, defineTool, requestBus } from '@hana/plugin-runtime';
```

Tools should return local files through `stageFile()` and `createMediaDetails()` so desktop, Bridge, and future mobile clients all consume the same `SessionFile` identity.

Lifecycle plugins should declare `activationEvents` in `manifest.json` when they do not need to start on app launch. Existing lifecycle plugins without this field still activate on startup for compatibility.

See `examples/plugins/sdk-showcase/` for a compact plugin that shows the current recommended shape.
