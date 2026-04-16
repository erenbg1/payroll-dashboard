# TREL Payroll Dashboard

This repository is deployable to Railway as a single service directly from the repository root.

## Railway Deployment

1. Select this GitHub repository in Railway.
2. Deploy the repository root as a single service.
3. Set the required environment variable:

`DASHBOARD_PASSWORD=Trelpayroll!2026`

Recommended additional variable:

`AUTH_TOKEN_SECRET=<random long secret>`

The root `Dockerfile` builds the frontend and serves it through the FastAPI backend, so no separate frontend service or root-directory configuration is required.
