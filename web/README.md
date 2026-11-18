# TrustLayer web workspace — Phase 3

Create the Next.js app here *after* the escrow ABI and arbitration interfaces stabilize:

```bash
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --use-npm
```

If the empty `web` directory already exists, remove this placeholder folder before using create-next-app, or run it in a temporary folder and move the created files into `web/`.

Do not store private keys in `NEXT_PUBLIC_*` variables or commit `.env.local`.
