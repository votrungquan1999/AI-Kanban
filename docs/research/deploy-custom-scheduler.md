# Deploy — Custom Scheduler (thin Node runner spawning `claude --bg` per card)

> Decision under study: **we build the scheduler ourselves**. This doc covers how to
> **deploy** that topology. Index + recommendation: [README](./README.md). Sibling
> research: [claude-scheduling-capabilities](./claude-scheduling-capabilities.md)
> (why the runner exists), [cost-analysis](./cost-analysis.md) (subscription vs API spend).
> Date: May 2026.

## The deployment problem in one paragraph

AI-Kanban is **local-first** (Path C). The runner is a **reconcile loop** that does an
**atomic WIP claim** on Mongo (`todo → in_progress`), shells out to `claude --bg` per
claimed card, and stores the returned claude.ai session URL on the card. Because it
operates on **local git worktrees** (`workspaces/`, branch `aikanban/card-N`) and spawns
**local** Claude sessions, the runner **cannot** move to the cloud — it must be an
always-on daemon on the user's machine. The **board** (Next.js) is only a review surface
and only needs the DB, so it *can* be remote. Deployment is therefore a **split**:
always-on local runner + (optionally) cloud-hosted board, joined by a shared database.

---

## 1. The runner as a local always-on daemon

The runner is a long-lived Node process. Four supervision options:

| Option | OS fit | Survives reboot | Restart on crash | Notes |
| --- | --- | --- | --- | --- |
| **launchd** | macOS native | ✅ `RunAtLoad` | ✅ `KeepAlive` watchdog (restarts in ms) | Built into macOS; no install. The native answer. |
| **systemd** | Linux only | ✅ `WantedBy=...` | ✅ `Restart=always` | Not present on macOS — irrelevant for a darwin dev. |
| **pm2** | cross-platform | ⚠️ via `pm2 startup` (which on macOS *generates a launchd plist anyway*) | ✅ auto-restart + logs | Nice DX (`pm2 logs`, `pm2 monit`) but on macOS it is a wrapper over launchd, adding a dependency for little gain. |
| **tmux / bare `claude --bg` supervisor** | any | ❌ dies on reboot | ❌ manual | Fine for dev poking; not a daemon. |

**Recommendation for a solo macOS dev: `launchd`** (a per-user **LaunchAgent** at
`~/Library/LaunchAgents/com.aikanban.runner.plist`). It is the OS-native process manager
on darwin, needs nothing installed, and has a configurable watchdog — if the runner
crashes, launchd restarts it within milliseconds; `RunAtLoad` brings it back after a
reboot/login. pm2 is a reasonable second choice **only** if you want its log/monitoring
ergonomics, but be aware it just shells out to launchd under the hood on macOS, so it is
strictly more moving parts. See [launchd watchdog notes][launchd-medium] and
[pm2-on-macOS-uses-launchd][pm2-startup].

LaunchAgent sketch (key fields): `ProgramArguments` → `node /abs/path/runner.js`;
`RunAtLoad=true`; `KeepAlive=true` (or `{SuccessfulExit:false}` to only restart on
failure); `StandardOutPath` / `StandardErrorPath` → log files; `EnvironmentVariables` for
secrets (see §5). Load with `launchctl bootstrap gui/$(id -u) <plist>`.

**LaunchAgent vs LaunchDaemon:** use a **LaunchAgent** (runs in the logged-in user
session). The runner needs the user's Claude credentials, git config, and SSH keys, which
live in the user context — a system-wide LaunchDaemon runs before/without login and would
not see them.

---

## 2. Where MongoDB lives

Both the **runner** and the **board** read/write the same collections (cards,
`card_events` audit log). So the DB location is dictated by **who needs to reach it**.

| Option | Reachable by remote board? | Cost | Ops burden | Verdict |
| --- | --- | --- | --- | --- |
| **Local `mongod` (Docker)** | ❌ only on-LAN / via tunnel | free | you run/back-up it | Great for all-local; blocks a cloud board unless you also tunnel the DB port. |
| **Atlas M0 (Free)** | ✅ from anywhere (IP allowlist) | $0 | managed, auto-backups on paid tiers | The connective tissue if the board is hosted remotely. |

**Decisive factor:** if the board is hosted remotely so the phone can reach it, the DB
must be reachable from **both** the local runner **and** the cloud board → **Atlas wins**.
If you keep everything local (board exposed only by tunnel), local `mongod` in Docker is
simpler and keeps all data on-machine.

**Atlas M0 (Free) limits** (current, May 2026): **512 MB** storage, **max 500
connections**, **one free cluster per project**, shared CPU/RAM, no time limit (permanently
free). Kanban metadata + a `card_events` log fits comfortably in 512 MB. Watch the
connection cap: with the Node **native driver**, set a small `maxPoolSize` on **both** the
runner and the board (and on Vercel, reuse the client across invocations) so serverless
cold starts don't exhaust the 500-connection budget. See [Atlas free-tier limits][atlas-free]
and [Atlas service limits][atlas-limits].

---

## 3. Where the Next.js board is hosted (so the phone can open it)

The board is RSC reads + Server Action writes against Mongo. It needs **only the DB** — not
the runner, not the local repos. Two families:

### (a) Run the board locally, expose via a tunnel

Run `next start` on the Mac and expose it to the phone:

| Tunnel | Always-on? | Stable URL | Cost / limits |
| --- | --- | --- | --- |
| **Tailscale** | ✅ (peer stays up) | ✅ stable MagicDNS name on your tailnet | Free **Personal** plan: up to 6 users, **unlimited devices**. Phone + Mac join the same private tailnet; no public exposure. |
| **ngrok** | ⚠️ session-bound | ❌ random URL on free | Free tier (post Feb 2026) is **harsh**: **2-hour** sessions, **random URLs**, **1 GB/mo**, interstitial warning page. |
| **cloudflared** | ✅ named tunnel | ✅ stable (with a domain) | Free; needs a Cloudflare-managed domain for a named tunnel. |

For a private solo tool, **Tailscale** is the standout: phone and Mac on one tailnet, a
stable private hostname, no public internet exposure, and the board "auth" is just tailnet
membership. ngrok's free tier is now too restrictive (2-hr sessions, rotating URLs) for an
always-open board. See [Tailscale free plan][tailscale-free] and [ngrok free limits][ngrok-free].

### (b) Deploy the board to Vercel pointing at Atlas

Fully cloud board, reachable from the phone over normal HTTPS, **independent of whether the
Mac is awake**. Caveats: Vercel **Hobby** is **non-commercial / personal use only**; free
limits include 1M function invocations/mo, **4 hrs Active CPU/mo**, 100 GB transfer, and a
**60 s** function cap. A private board behind real auth on a revenue product needs **Pro**.
Atlas IP allowlist must permit Vercel egress (`0.0.0.0/0` + DB auth, or PrivateLink on paid
tiers). See [Vercel Hobby plan][vercel-hobby] and [Vercel limits][vercel-limits].

**Key property:** because the board only needs the DB, option (b) lets the board stay up
**even when the laptop sleeps** — you just can't *start new card work* until the runner's
machine is awake (see §6). The board still renders the queue and past `card_events`.

---

## 4. Split of concerns + topology

Two independently-deployable halves joined by Mongo and by claude.ai (for review):

```
            ┌─────────────────────── User's Mac (must be AWAKE) ───────────────────────┐
            │                                                                            │
            │   launchd LaunchAgent ──▶ Runner (Node)                                    │
            │        (RunAtLoad,           │ reconcile loop                              │
            │         KeepAlive)           │ atomic WIP claim (todo→in_progress)         │
            │                              │ spawn `claude --bg` per card                │
            │                              ▼                                             │
            │                       claude --bg sessions ──▶ local git worktrees         │
            │                              │  (workspaces/, aikanban/card-N)             │
            └──────────────────────────────┼─────────────────────────────────────────────┘
                                           │ writes session URL to card
                                           ▼
                  ┌──────────────── MongoDB Atlas M0 (cloud) ────────────────┐
                  │   cards  +  card_events audit log                         │
                  └───────────────┬───────────────────────────┬──────────────┘
                                  │ reads/writes              │ reads/writes
                                  ▼                            ▼
                       Board on Vercel (cloud)        (or) Board local + Tailscale
                                  │                            │
                                  └────────────┬───────────────┘
                                               ▼
                                          📱 Phone
                              (opens board; opens each card's
                               claude.ai session via Remote Control)
```

- **Always-on LOCAL half:** runner + `claude --bg` sessions. Hard requirements: machine
  awake, repos present, Claude auth valid, Mongo reachable.
- **Phone-accessible half:** the board. Soft requirements: just DB reachability. Can be
  fully cloud (Vercel + Atlas) and survives the Mac sleeping.
- **Review path is orthogonal:** per-card sessions are reviewed on the phone via claude.ai
  **Remote Control** using the stored session URL — this does **not** depend on how the
  board is hosted.

---

## 5. Secrets / env

| Secret | Runner (local) | Board (Vercel/local) | Notes |
| --- | --- | --- | --- |
| `MONGODB_URI` | ✅ | ✅ | Atlas SRV string. On the runner, put it in the LaunchAgent `EnvironmentVariables` or a sourced env file; on Vercel, project env vars. |
| **Claude auth** | ✅ | ❌ | The runner spawns `claude --bg`; the board never calls Claude. See gotcha below. |
| Source tokens (`GH_TOKEN`, etc.) | ✅ (if sessions push/clone) | ❌ | Live in the runner's user context so `claude --bg` and git inherit them. |

**Claude auth for unattended `claude --bg` — the gotcha.** Interactive Claude Code uses a
**subscription OAuth login**, but the browser-based login flow assumes a human and tokens
can lapse. For **unattended / headless** runs there are two supported paths:

1. **`CLAUDE_CODE_OAUTH_TOKEN`** — a long-lived token from `claude setup-token`, billed
   against your **Pro/Max subscription**. Cheapest for 1–3 concurrent agents, but it is a
   subscription credential and you can hit subscription **rate limits** with many parallel
   `--bg` sessions overnight.
2. **`ANTHROPIC_API_KEY`** — never expires, ideal for a 24/7 fleet, billed **per-token**
   (can get expensive at scale).

The trap: do **not** rely on the ambient interactive login persisting inside a launchd
agent — set an explicit `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) in the
LaunchAgent env so the daemon-spawned `claude --bg` authenticates without a browser. A
common hybrid: subscription token for the interactive primary, API key for the burst
fleet. Cost tradeoffs are detailed in [cost-analysis](./cost-analysis.md). See
[Claude Code authentication][cc-auth] and [headless self-hosting guide][cc-headless].

---

## 6. The "machine must be awake" limitation

Local-first means **no work happens while the Mac sleeps** — the runner's reconcile loop
and every `claude --bg` session pause. (The Vercel board still serves reads; only *new*
card execution stalls.) Mitigations, cheapest first:

1. **`caffeinate`** — wrap the runner so the Mac won't idle-sleep while it runs:
   `caffeinate -is node runner.js` (`-i` prevent idle sleep, `-s` prevent system sleep on
   AC). In a LaunchAgent, make `ProgramArguments` invoke `caffeinate -is` as the wrapper.
   Note `-s` is **AC-power only**, so keep the laptop plugged in. See [caffeinate][caffeinate-ss64].
2. **Disable sleep / lid-closed sleep** (Energy Saver / `pmset`) and leave the laptop on.
3. **Dedicated always-on box** — a Mac mini or a spare Mac left powered, repos cloned,
   runner installed as a LaunchAgent. This is the robust answer for "agents work overnight"
   and pairs naturally with the **API key** auth path (§5) for sustained throughput.

`caffeinate` only stops *idle* sleep; it does not survive a reboot by itself — that is what
launchd `RunAtLoad` is for. The two compose: launchd brings the runner back after reboot,
`caffeinate` keeps the machine awake while it runs.

---

## 7. Recommended topologies

### A. Recommended (phone-first, board survives sleep)

- **Runner:** launchd LaunchAgent on the Mac, wrapped in `caffeinate -is`, with
  `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) + `MONGODB_URI` in its env.
- **DB:** **Atlas M0** (reachable by both halves).
- **Board:** **Vercel** (Hobby for personal; Pro if commercial/auth) → Atlas.
- **Review:** phone opens the board; taps a card's stored claude.ai URL for Remote Control.
- **Why:** board is reachable anywhere and stays up when the Mac sleeps; only *new* card
  execution needs the Mac awake. Clean local/cloud split.

### B. Simpler "all-local" starter

- **Runner:** launchd LaunchAgent (same as above), `caffeinate` optional at first.
- **DB:** local `mongod` in **Docker**.
- **Board:** `next start` locally, exposed to the phone via **Tailscale** (stable private
  hostname, no public exposure, free Personal plan).
- **Review:** same claude.ai Remote Control path.
- **Why:** zero cloud accounts, all data on-machine, fastest to stand up. Trade-off: board
  is only reachable while the Mac is awake and on the tailnet. Migrate the DB to Atlas and
  the board to Vercel (topology A) when you want the board reachable 24/7.

**Migration path A←B:** point both runner and board at an Atlas `MONGODB_URI`, deploy the
board to Vercel, drop the Tailscale tunnel. The runner LaunchAgent is unchanged.

---

## Sources

- MongoDB Atlas free-tier limits — <https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/>
- MongoDB Atlas service limits — <https://www.mongodb.com/docs/atlas/reference/atlas-limits/>
- Vercel Hobby plan — <https://vercel.com/docs/plans/hobby>
- Vercel limits — <https://vercel.com/docs/limits>
- Tailscale free plans — <https://tailscale.com/docs/account/manage-plans/free-plans-discounts>
- ngrok free plan limits — <https://ngrok.com/docs/pricing-limits/free-plan-limits>
- launchd watchdog / KeepAlive — <https://medium.com/swlh/how-to-use-launchd-to-run-services-in-macos-b972ed1e352>
- pm2 startup uses launchd on macOS — <https://pm2.keymetrics.io/docs/usage/startup/>
- Claude Code authentication — <https://code.claude.com/docs/en/authentication>
- Claude Code headless self-hosting guide — <https://amux.io/guides/claude-code-headless/>
- macOS caffeinate — <https://ss64.com/mac/caffeinate.html>

[atlas-free]: https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/
[atlas-limits]: https://www.mongodb.com/docs/atlas/reference/atlas-limits/
[vercel-hobby]: https://vercel.com/docs/plans/hobby
[vercel-limits]: https://vercel.com/docs/limits
[tailscale-free]: https://tailscale.com/docs/account/manage-plans/free-plans-discounts
[ngrok-free]: https://ngrok.com/docs/pricing-limits/free-plan-limits
[launchd-medium]: https://medium.com/swlh/how-to-use-launchd-to-run-services-in-macos-b972ed1e352
[pm2-startup]: https://pm2.keymetrics.io/docs/usage/startup/
[cc-auth]: https://code.claude.com/docs/en/authentication
[cc-headless]: https://amux.io/guides/claude-code-headless/
[caffeinate-ss64]: https://ss64.com/mac/caffeinate.html
