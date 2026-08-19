# Oasis Call Center

An AI-powered call center management system for handling inbound calls, support tickets, and agent performance analytics. Built for the UPTET-2026 candidate helpline.

## Features

- **Call Management** — Log, track, and filter inbound/outbound calls with audio playback
- **AI Call Analysis** — Automatic transcription, categorization, and quality scoring via Google Gemini
- **Ticket System** — Create and manage support tickets linked to calls, with timeline notes
- **Agent Management** — Admin can create agents, reset passwords, and bulk import via Excel
- **Click-to-Call** — Initiate outbound calls via BuzzDial integration
- **Role-Based Access** — Separate views and permissions for Admins and Agents
- **Dashboard Analytics** — Call stats, received/missed breakdown, agent performance metrics

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS |
| Backend | Node.js, Express 5 |
| Database | MongoDB (Atlas) |
| AI | Google Gemini API (`gemini-1.5-flash`) |
| Telephony | BuzzDial API |
| Auth | JWT + bcrypt |
| Containerisation | Docker & Docker Compose |

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── routes/          # auth, calls, tickets, analysis, agents, webhook
│   │   ├── middleware/       # JWT auth (requireAuth, requireAdmin)
│   │   ├── services/         # geminiService — audio analysis
│   │   ├── workers/          # analysisWorker — background AI processing
│   │   ├── db.js             # MongoDB connection & indexes
│   │   ├── logger.js         # Winston logging
│   │   └── server.js         # Express app entry point
│   ├── .env.example
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── pages/            # Dashboard, CallReport, Tickets, AIAnalysis, Agents, Login
│   │   ├── components/       # CallsTable, modals, AudioPlayer, Sidebar, Pagination
│   │   ├── contexts/         # AuthContext — JWT token & user state
│   │   ├── hooks/            # useCalls — API access layer
│   │   └── App.jsx           # Router & shell
│   ├── nginx.conf
│   └── Dockerfile
│
├── docker-compose.yml
└── .gitignore
```

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- MongoDB Atlas cluster
- Google Gemini API key
- BuzzDial account (for click-to-call)

### Setup

**1. Clone the repo**
```bash
git clone https://github.com/vijaysharma-gif/oasis-call-center.git
cd oasis-call-center
```

**2. Configure environment variables**
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in all required values (see [Environment Variables](#environment-variables)).

**3. Build and start**
```bash
docker compose up -d --build
```

The app will be available at `http://localhost`.

**4. First login**

Use the `ADMIN_USERNAME` / `ADMIN_PASSWORD` values from your `.env` file.

---

## Environment Variables

All variables are set in `backend/.env`. Use `backend/.env.example` as a reference.

| Variable | Description |
|---|---|
| `PORT` | Backend port (default: `3001`) |
| `NODE_ENV` | `production` or `development` |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `BUZZDIAL_AUTH` | BuzzDial API credentials |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Gemini model ID (default: `gemini-1.5-flash`) |
| `JWT_SECRET` | Long random string for signing JWTs |
| `ADMIN_USERNAME` | Default admin login username |
| `ADMIN_PASSWORD` | Default admin login password |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins |

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login (admin or agent) |
| `POST` | `/api/auth/refresh` | Silently refresh JWT |
| `POST` | `/api/auth/change-password` | Agent changes password |
| `GET` | `/api/calls` | List calls (role-scoped) |
| `GET` | `/api/calls/stats/summary` | Dashboard stats |
| `POST` | `/api/calls/initiate` | Initiate click-to-call |
| `GET` | `/api/tickets` | List tickets |
| `POST` | `/api/tickets` | Create ticket |
| `PUT` | `/api/tickets/:id` | Update ticket |
| `GET` | `/api/analysis` | List AI analysis results |
| `GET` | `/api/agents` | List agents (admin) |
| `POST` | `/api/agents` | Create agent (admin) |
| `POST` | `/api/agents/bulk` | Bulk import agents via Excel (admin) |
| `POST` | `/webhook/recording` | Telephony webhook receiver |
| `GET` | `/health` | Health check |

---

## Authentication & Roles

Agents log in with their **agent number** as username. On first login they are forced to change their password.

| Feature | Agent | Admin |
|---|---|---|
| View own calls | ✓ | ✓ |
| View all missed calls | ✓ | ✓ |
| View all calls | ✗ | ✓ |
| Create / update tickets | ✓ | ✓ |
| AI Analysis page | ✓ | ✓ |
| Manage agents | ✗ | ✓ |
| View agent metrics | ✗ | ✓ |

---

## AI Analysis Pipeline

1. Telephony system POSTs call data to `/webhook/recording`
2. If a recording URL is present, the call is enqueued for analysis
3. Background worker polls every 10 seconds for pending calls
4. Gemini processes the audio (streamed directly — no local download) and returns:
   - Full speaker-labelled transcription
   - Call category & sub-category
   - Agent score (1–10)
   - Call resolved (Yes / No / Partial)
   - Bugs reported
   - Audio quality rating
   - AI insight summary

---

## Docker

The `docker-compose.yml` runs two containers on a shared network:

| Container | Image | Exposed Port |
|---|---|---|
| `oasis-backend` | Node 20 Alpine | internal `3001` |
| `oasis-frontend` | Nginx Alpine | `80` |

Nginx serves the built React app and proxies `/api/*` and `/webhook/*` to the backend container.

```bash
# Start
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

### Deploying to the server

CodeBuild (`buildspec.yml`) only builds and pushes images to ECR. Bringing them
up on the host is a separate step, and it must go through compose:

```bash
./scripts/deploy.sh            # pull + restart everything, then verify
./scripts/deploy.sh backend    # one service
```

**Never create a container with `docker run`.** A hand-run container joins its
own network, so nginx can no longer resolve `backend`; every proxied request —
including every BuzzDial webhook — becomes a 502 that the backend never sees
and never logs. That exact failure ran from roughly 10 June to 19 August 2026
and cost about 2,200 calls. Nothing in the application was wrong, and nothing in
its logs showed it.

Two guards now exist against a repeat:

- `docker-compose.deploy.yml` keeps the production topology in the repository,
  so the containers and the manifest cannot drift apart.
- The frontend's healthcheck probes `/health` **through** the proxy, so a split
  network shows as `unhealthy` in `docker ps` rather than as silence.

If webhooks ever go quiet again, the first thing to check is the edge, not the
app:

```bash
sudo grep webhook /var/log/nginx/access.log | tail
```

A `502` there means the delivery never reached the backend.
