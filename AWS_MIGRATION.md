# Ambassador Program: Railway → AWS (`admin.lovepop.com/ambassador`)

Started 2026-10-22, after the Railway breach. Direct cutover; downtime is fine.

## Why, and what Railway had

| Item | State |
|---|---|
| Exposure | Railway had no `JWT_SECRET`, so tokens were signed with the default in `server.js` (in git) — anyone could forge a team token. Team logins `admin/lovepop2024`, `team/ambassador123` were hard-coded. `/uploads` was served without auth. |
| Railway | **Stopped 2026-10-22 15:35 UTC**: GitHub source disconnected, `railway down`, deployment REMOVED, URL 404. Never restart it. |
| Data | SQLite on a Railway volume. Snapshot taken just before the stop (sha256 matched). It held **only `scripts/seed.js` demo data** (6 `@example.com` influencers, every row stamped 2026-04-14 16:37:59, never edited) and **0 uploads**. Nothing to carry over: AWS starts with an empty database. |
| Variables | `DB_PATH`, `NODE_ENV`, `PORT` only. No secret to reuse. |

## Target

| Thing | Value |
|---|---|
| URL | `https://admin.lovepop.com/ambassador` (public: influencers are outside people; CloudFront + admin-alb let anonymous visitors in, as `/ideas/p/…` does) |
| ECS | `ambassador-data-service` on prod-cluster; ECR `ambassador`; module terraform-module-ecs v0.0.12; port 3001 |
| admin-alb :443 | `/ambassador`, `/ambassador/*`, **priority 31** (live listener 2026-10-22: 1, 10–17, 20–25, 27–30, 100; 18 and 26 claimed by open PRs) |
| Database | Postgres `ambassador` (role `ambassador`) on the data-team RDS cluster, via data-ml-mono `db_migration init-db ambassador`; schema from `server/migrations/*.sql` on boot. Local dev and tests use embedded PGlite. |
| Uploads | `s3://prod-segment-model-store/ambassador/uploads/` (instance role `prod-ecs-instance-role`, as idea-lab), served back through the app at `/ambassador/uploads/…`; bucket stays private |
| SSM `/ambassador/` | `database_url`, `sso_ticket_secret` (copied, verified equal to conan's), `team_session_secret`, `influencer_session_secret` (both generated) — `infra/scripts/put_ssm_params.py` |
| CI | `.circleci/config.yml`: test on every branch; `main` → `build_custom` → plan → apply → verify |

## Two kinds of user

| Who | Sign-in | Session | Can reach |
|---|---|---|---|
| Lovepop team | `/ambassador/team` → conan SSO broker (Google, Lovepop domains) → ticket | httpOnly cookie `ambassador_team` (12 h) | everything (`teamOnly` routes) |
| Influencers (external) | email + bcrypt password on the page, unchanged | httpOnly cookie `ambassador_influencer` (7 d) | their own profile and posts, campaigns |
| Anyone | — | — | landing page, `POST /api/signup` |

- The team password login (`/api/auth/team-login`) and every hard-coded credential are removed.
- Both sessions are cookies (not a bearer token in localStorage): CloudFront forwards cookies, and httpOnly keeps them away from page scripts.
- Fail-closed: behind `BASE_PATH` the server refuses to start unless the SSO settings and both session secrets are set. The local `dev` team sign-in exists only without `BASE_PATH` and outside `NODE_ENV=production`.
- No auto-seed on boot. `npm run seed` loads demo data locally only.

## Uploads

| Kind | Key | Who can read |
|---|---|---|
| Contracts | `contracts/<random>.<ext>` | team only |
| Campaign images | `campaigns/<random>.<ext>` | anyone with the link (shown to influencers) |
| Post screenshots | `posts/<random>.<ext>` | anyone with the link (as before) |

Random names come from `crypto.randomBytes`. Only images (jpg, png, gif, webp) and PDFs are served inline. Everything else is served as a download (`nosniff`), so an upload can't run script on admin.lovepop.com.

## Steps

| # | Step | Owner | Done when |
|---|---|---|---|
| 1 | Code PR `feat/aws-migration` (this repo): Postgres port, auth split, S3 store, base path, infra/, CircleCI, Dockerfile, tests | us | tests green; local Docker in prod shape + Chrome click-through passed |
| 2 | data-ml-mono PR: `db_migration/apps/ambassador.yaml` + `.md`; `init-db ambassador` → `.env` `AMBASSADOR_AWS_DATABASE_URL` | us | role + DB exist |
| 3 | SSM: `python3 infra/scripts/put_ssm_params.py --env-file <data-ml-mono .env>` | user runs | 4/4 ok |
| 4 | conan-edogawa PR: `ssoAllowedReturnUrls` += `https://admin.lovepop.com/ambassador` | us → DevOps merge | merged, broker accepts |
| 5 | devops-portal PR (base dev): `ambassador-data-service` + `/ambassador` ssm folder | us → DevOps merge | merged |
| 6 | CircleCI: Set Up Project on the PR branch + User Key | us in Chrome / user | branch test job green |
| 7 | Merge #1 (merge commit) → CircleCI build/plan/apply/verify | user | ECS 1/1, `/ambassador/healthz` 200 |
| 8 | Smoke: anonymous landing + signup; team SSO (user clicks Google); influencer login after approval | us + user | all pass |
| 9 | Delete the Railway project `lovepop-ambassador-program` (7501f2f1-…) | user | API "Project not found" |

## Smoke test

`curl` `/ambassador/healthz` → 200; `/ambassador/` → 200 (public page); `/ambassador/team` → 302 to `authentication.lovepopcards.com/sso/authorize?return_to=https%3A%2F%2Fadmin.lovepop.com%2Fambassador%2Fteam`; `/ambassador/api/influencers` → 401. Chrome: team sign-in lands on the dashboard; signup → approve with a password → influencer login → submit a post with a screenshot → team sees it.

## Rollback

None to Railway (breached; stays off). Revert the merge on `main` to redeploy the previous image.
