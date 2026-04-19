# VitalSage

AI-assisted web performance optimization — drop-in SDK for any website.

## Packages

| Package | Description |
|---------|-------------|
| [`vitalsage`](packages/client) | Browser SDK — collects Core Web Vitals |
| [`vitalsage-analysis`](packages/analysis) | Server-side analysis engine with AI suggestions |
| [`vitalsage-simulator`](packages/simulator) | Playwright synthetic runner |
| [`vitalsage-cli`](packages/cli) | `npx vitalsage` CLI |
| [`@vitalsage/types`](packages/types) | Shared TypeScript types (zero runtime) |

## Quick Start

```bash
npm install vitalsage
```

```typescript
import { init } from 'vitalsage';

init({
  storage: {
    adapter: {
      onReport: (report) => fetch('/api/perf', {
        method: 'POST',
        body: JSON.stringify(report),
        keepalive: true,
      }),
    },
  },
});
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## License

MIT
