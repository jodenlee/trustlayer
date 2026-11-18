# Frontend location

The Phase 3A Next.js application lives in [`apps/web`](../apps/web), with its own npm package and lockfile. This historical directory remains as a pointer; do not initialize a second application here.

From the repository root:

```powershell
npm.cmd --prefix apps/web ci
npm.cmd run web:dev
```

Open http://127.0.0.1:3000. See [Phase 3A](../docs/PHASE3A.md) for architecture, verification, and remaining integration work. Never put private keys in `NEXT_PUBLIC_*` variables or commit populated environment files.
