# etzhayyim-project-fleamarket App

## Components

- `fleamarket-ui-k6p4x2n9`
  - includes: `components/fleamarket-mcp-component` (Clerk 認証付き MCP facade)
  - `70-tools/etzhayyim-static-site` で static 配信
  - route: `/api/mcp`, `/{nanoid}/api/mcp`, `/healthz`
  - host: `fleamarket.etzhayyim.com`

## Build

```bash
cd fleamarket-ui-k6p4x2n9 && etzhayyim build
```

## Deploy (example)

```bash
cd fleamarket-ui-k6p4x2n9 && kubectl apply -f <repo-deploy-config>
```
