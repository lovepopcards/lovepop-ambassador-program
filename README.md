# Lovepop Ambassador Program

A full-stack web application for managing Lovepop brand ambassadors and influencers.

## Features

**Lovepop Team Experience**
- Influencer management with card grid layout
- Approval workflow (Pending → Approved/Rejected)
- Contact management per influencer
- Timestamped notes system
- Contract/agreement uploads
- Campaign creation and management
- Product bundle and SKU management
- Post submission review (Approve/Reject)
- Overview dashboard with key stats

**Influencer Experience**
- Compelling public landing/recruitment page
- Signup/application form
- Authenticated dashboard
- Tier system: Bronze → Silver → Gold → Platinum → Diamond
- Post submission with screenshot upload
- Campaign viewing with product bundle details
- Progress tracking toward next tier

## Tech Stack

- **Backend**: Node.js 22 + Express 4 (`server/`: `app.js` routes, `auth.js` sessions, `db.js`, `mediaStore.js`)
- **Database**: Postgres — the `ambassador` database on the data-team RDS cluster in production;
  embedded PGlite (`.data/pglite`) locally and in tests. Schema: `server/migrations/*.sql`, applied on boot.
- **Auth**: Lovepop team via the conan-edogawa SSO broker (`/team`); ambassadors with email + bcrypt
  password. Both are httpOnly cookie sessions (see `server/auth.js`).
- **File uploads**: multer → S3 `s3://prod-segment-model-store/ambassador/uploads/` in production
  (local folder `data/uploads` otherwise), served back through the app; contracts are team-only.
- **Frontend**: Vanilla JS + HTML + CSS (`public/`); the server injects `BASE_PATH` into `index.html`.

## Getting Started

### Requirements
- Node.js 22 or higher

### Install & Run

```bash
npm install
npm test        # hermetic: embedded Postgres, no network
npm run seed    # local demo data (refuses when DATABASE_URL or NODE_ENV=production is set)
npm start       # http://localhost:3001
```

Run locally **without** `DATABASE_URL` in your shell (the server refuses any database that is not
`ambassador`). Team sign-in locally: open http://localhost:3001/team (dev mode signs you in as
"Local Dev"). Demo ambassador logins are printed by `npm run seed`.

## Production

Served at **https://admin.lovepop.com/ambassador** (ECS `ambassador-data-service`, admin-alb priority 31),
deployed by CircleCI on every merge to `main` (merge commits only). Config: `infra/prod.yaml`;
secrets: SSM `/ambassador/*` (`infra/scripts/put_ssm_params.py`). The server refuses to start behind
`BASE_PATH` unless SSO and both session secrets are set. Migration record: `AWS_MIGRATION.md`.

- Team: **Lovepop team** tab → "Continue with your Lovepop Google account".
- Ambassadors: public landing page and application form; they sign in with the password the team
  sets when approving them.
- `/healthz` (unprefixed) is the ALB health check.

## Tier System

Tier is calculated as: `score = total_approved_posts + (total_impressions / 10,000)`

| Tier | Score Required |
|------|---------------|
| Bronze | 0 (starting) |
| Silver | 15+ |
| Gold | 35+ |
| Platinum | 75+ |
| Diamond | 150+ |

## Project Structure

```
/
├── public/                 # single-page app (landing + both dashboards)
├── server/
│   ├── index.js            # boot: config check, DB, listen
│   ├── app.js              # Express app + API routes
│   ├── auth.js             # team SSO + ambassador sessions
│   ├── db.js               # pg / PGlite adapter + migrations
│   ├── mediaStore.js       # uploads (S3 or local folder)
│   └── migrations/         # SQL schema
├── scripts/seed.js         # local demo data
├── test/                   # node:test suites
├── infra/                  # terraform-module-ecs prod.yaml + SSM script
├── .circleci/config.yml    # test → build → plan → apply → verify
└── Dockerfile
```
