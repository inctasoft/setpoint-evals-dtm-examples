# uitools

Optional UI tool configurations for local development.

## pgAdmin

`pgadmin-servers.json` — Pre-configured server definitions for all DTM databases.

To use with pgAdmin:

```bash
docker run -d \
  -p 5050:80 \
  -e PGADMIN_DEFAULT_EMAIL=admin@local.dev \
  -e PGADMIN_DEFAULT_PASSWORD=admin \
  -e PGADMIN_SERVER_JSON_FILE=/pgadmin4/servers.json \
  -v $(pwd)/uitools/pgadmin-servers.json:/pgadmin4/servers.json:ro \
  --network dtm \
  --name dtm-pgadmin \
  dpage/pgadmin4
```

Then open http://localhost:5050 and log in with `admin@local.dev` / `admin`.
All 4 DTM databases will be pre-configured (orchestrator DB + 3 workflow source DBs).
