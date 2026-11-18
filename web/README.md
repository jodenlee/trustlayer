# Frontend location

The Next.js application lives in [`apps/web`](../apps/web), with its own npm package and lockfile. It includes the Phase 3A foundation and Phase 3B wallet/read integration. This historical directory remains as a pointer; do not initialize a second application here.

From the repository root:

```powershell
npm.cmd --prefix apps/web ci
npm.cmd run web:dev
```

Open http://127.0.0.1:3000. See [Phase 3B](../docs/PHASE3B.md) for persistent local-node setup, deployment exports, verification, and remaining work. Never put private keys in `NEXT_PUBLIC_*` variables or commit populated environment files.
