# Coding Conventions + Common Task Recipes

## Code conventions

- **Every file that uses React hooks or browser APIs must have `'use client'` as its first line.**
- Use `@/` path alias for all imports (maps to project root).
- UI primitives come from `components/ui/` (shadcn/ui). **Do not edit these files by hand** — add new ones with `npx shadcn-ui add <component>`.
- Tailwind CSS for all styling. Primary action color: `emerald-600`. Irrigated/water: `cyan-*`. Neutral/text: `slate-*`.
- Async operations in components follow this pattern:
  ```ts
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  try {
    // ...
  } catch (err) {
    setError(err instanceof Error ? err.message : '...')
  }
  ```
- New John Deere data types go in `types/john-deere.ts`.
- New API calls go in `lib/john-deere-client.ts` (client-side fetch wrapper) and the corresponding edge function.

## Common task: add a new dashboard data view

1. Add an action handler in the appropriate edge function (or create a new one in `supabase/functions/`).
2. Add a `fetchYourData()` function in `lib/john-deere-client.ts`.
3. Add response types to `types/john-deere.ts`.
4. Create a component in `components/dashboard/` or `components/map/` and wire it into the appropriate page.

## Common task: deploy to Vercel

The repo is connected on Vercel — Next.js is auto-detected, no config file required. Set the four `NEXT_PUBLIC_*` environment variables in **Project Settings → Environment Variables** (Production, Preview, Development). Vercel builds and deploys automatically on every push to `main`.
