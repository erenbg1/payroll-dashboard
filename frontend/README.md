# TREL Payroll Dashboard Frontend

## Local Development

Run the frontend with the backend API URL set in `VITE_API_URL`.

Example:

```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

## Railway Deployment

Create a dedicated Railway service for the frontend with:

- Root Directory: `frontend`
- Environment variable: `VITE_API_URL=<your backend Railway URL>`

The production image builds the Vite app and serves it through nginx with Railway's assigned port.
