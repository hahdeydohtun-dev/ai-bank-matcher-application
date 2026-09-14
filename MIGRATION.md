# Migrating ai-bank-matcher-application from Lovable Cloud to your own Supabase

This guide is specific to this repo. It reflects what's actually in the codebase
as of the commit this was generated from.

## What this project uses (confirmed by inspection)

- **Current backend**: Lovable Cloud, project ref `vdzsswftseoqrtghdfsv`
- **Schema**: 26 migration files in `supabase/migrations/`, timestamped
  2026-07-27 through 2026-09-05. These are your full schema + RLS policy history.
- **Storage buckets**: none found. Nothing to migrate here.
- **Edge functions**: none found. Nothing to migrate here.
- **Auth**: standard Supabase Auth via `src/integrations/supabase/client.ts`
  (browser, anon key) and `client.server.ts` (server-only, service role key).
- **Env vars in use**: see `.env.example` (just added) for the full list.
  The service role key was NOT found in the committed `.env` - only the
  URL, project ID, and publishable/anon key were exposed.

## Step-by-step

### 1. Create your new Supabase project
Go to https://supabase.com/dashboard, create a project, and save the
database password it gives you (you'll need it for direct Postgres access).

### 2. Export current data from Lovable Cloud
In the Lovable editor: Cloud tab -> Overview -> Advanced Settings ->
"Export project data". This gets you the actual rows (not just schema -
the schema is already safe in `supabase/migrations/`).

### 3. Link this repo to your new project and push the schema
```bash
npm install -g supabase
supabase login
cd ai-bank-matcher-application
supabase link --project-ref YOUR_NEW_PROJECT_REF
supabase db push
```
This replays all 26 migrations in order against your new project, recreating
every table and RLS policy exactly as they exist today.

### 4. Import your data
Use the Supabase dashboard's Table Editor -> Import, or `psql`/`pg_dump`
restore, to load the data you exported in step 2 into the new project's
tables. Since there's no storage buckets or edge functions, this is the
only data-move step needed.

### 5. Handle auth users
Supabase re-hashes passwords, so existing users' passwords generally can't
carry over directly. Standard approach: import user emails/profiles, and
have users reset their password on next login. (Since this project isn't
published yet, this is a non-issue right now - there are no real users.)

### 6. Update your environment variables
Copy `.env.example` to `.env`, then fill in the real values from your NEW
Supabase project (Settings -> API):
- `SUPABASE_URL` / `VITE_SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only - from the same Settings -> API
  page, the "service_role" secret key. Never prefix this with VITE_.)

### 7. Test
Run locally with `npm run dev` (or `bun dev`) and confirm reads/writes work
against the new project before deploying anywhere.

### 8. Cut over in Lovable (optional, only if you still want to edit via Lovable)
Lovable Cloud -> Advanced Settings -> Remove Lovable Cloud, then connect
your own Supabase project from the Integrations tab, using the same
project ref you created in step 1.

### 9. Deploy
Once steps 1-7 are done, the app is a standard Vite + TanStack Start app
with an independent Supabase backend - deployable to Vercel/Netlify/Cloudflare
Pages with the env vars from step 6 set in the platform's dashboard, not in
the repo.

## What I already fixed in this copy of the repo

- Added `.env`, `.env.local`, `.env.*.local` to `.gitignore`
- Removed `.env` from git tracking (`git rm --cached .env`)
- Added `.env.example` as a safe template with variable names only

You still need to `git commit` and `git push` these changes yourself from
your own machine (or apply the same diff), since I don't have write access
to your GitHub repo.
