# Flux Atlas Deployment Guide

## Overview
Flux Atlas is a network visualization tool for the Flux blockchain. This guide covers deployment options for running it on Flux nodes.

## Prerequisites
- Docker installed
- At least 2GB RAM available
- Port 3000 available (serves both frontend and backend API)

## Quick Start with Docker

### Option 1: Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd Flux_Atlas_js_react_sigma

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

### Option 2: Using Docker directly

```bash
# Build the image
docker build -t flux-atlas:latest .

# Run the container
docker run -d \
  --name flux-atlas \
  -p 3000:3000 \
  --restart unless-stopped \
  flux-atlas:latest

# View logs
docker logs -f flux-atlas

# Stop the container
docker stop flux-atlas
docker rm flux-atlas
```

## Configuration

### Environment Variables

Edit `docker-compose.yml` or pass via Docker `-e` flags:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `PORT` | `3000` | Server port (serves both frontend and API) |
| `FLUX_UPDATE_INTERVAL` | `1800000` | Build interval in ms (30 min) |
| `FLUX_SEED_NODE` | `https://api.runonflux.io` | Flux API endpoint |
| `RPC_TIMEOUT` | `10000` | RPC request timeout (ms) |
| `MAX_CONCURRENT_FETCHES` | `50` | Max parallel node fetches |
| `LAYOUT_SEED` | `flux-atlas-2024` | Deterministic layout seed |
| `LAYOUT_NODE_CAP` | `5000` | Max nodes for force layout |
| `FLUX_INCLUDE_EXTERNAL_PEERS` | `false` | Include external peers |
| `RPC_PROTOCOL` | `http` | Node RPC protocol |
| `RPC_PORT` | `16127` | Node RPC port |

### Customizing Rebuild Interval

For production on Flux, 30-minute intervals are recommended:

```yaml
environment:
  - FLUX_UPDATE_INTERVAL=1800000  # 30 minutes
```

For testing/development, use shorter intervals:

```yaml
environment:
  - FLUX_UPDATE_INTERVAL=600000  # 10 minutes
```

## Accessing the Application

Once running:
- **Application**: http://localhost:3000
- **API Endpoint**: http://localhost:3000/api/state
- **Health Check**: http://localhost:3000/healthz

## Health Monitoring

The `/healthz` endpoint provides:
- Service status
- Uptime
- Memory usage
- Node/edge counts
- Last build timestamp

Example response:
```json
{
  "status": "ok",
  "uptime": 3600,
  "nodes": 8521,
  "edges": 128027,
  "lastBuild": "2024-10-07T23:02:35.959Z",
  "memory": {
    "heapUsed": 245,
    "heapTotal": 312,
    "rss": 389
  }
}
```

## Flux Deployment

### Publishing to Flux Marketplace

1. **Build and push Docker image**:
```bash
docker build -t your-dockerhub-username/flux-atlas:latest .
docker push your-dockerhub-username/flux-atlas:latest
```

2. **Create Flux app specification**:
```json
{
  "name": "flux-atlas",
  "description": "Flux Network Atlas Visualization",
  "owner": "your-zelid",
  "repotag": "your-dockerhub-username/flux-atlas:latest",
  "port": 3000,
  "enviromentParameters": [
    "FLUX_UPDATE_INTERVAL=1800000"
  ],
  "containerPorts": "3000",
  "containerData": "",
  "cpu": 1,
  "ram": 2048,
  "hdd": 5,
  "tiered": false,
  "instances": 1
}
```

3. **Register via FluxOS**:
   - Navigate to Flux Apps section
   - Click "Register New App"
   - Paste specification JSON
   - Pay registration fee
   - Wait for approval

### Resource Requirements

| Tier | CPU | RAM | HDD | Recommended |
|------|-----|-----|-----|-------------|
| Minimum | 0.5 | 1GB | 3GB | Development only |
| Recommended | 1 | 2GB | 5GB | Production |
| Optimal | 2 | 4GB | 10GB | High traffic |

## Production Optimizations

### 1. Security Headers
✅ Helmet.js enabled for security headers
✅ CORS configured for cross-origin requests
✅ Rate limiting: 100 req/min per IP

### 2. Performance
✅ Gzip compression via Express
✅ JSON payload limit: 1MB
✅ Docker multi-stage build for minimal image size

### 3. Reliability
✅ Health checks every 30s
✅ Auto-restart on failure
✅ Graceful error handling
✅ Structured logging

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs flux-atlas

# Verify ports are available
netstat -tuln | grep 3000
```

### High memory usage
- Reduce `LAYOUT_NODE_CAP` if handling large networks
- Increase Docker memory limit
- Monitor via `/healthz` endpoint

### Build failures
```bash
# Rebuild without cache
docker build --no-cache -t flux-atlas:latest .

# Check Node.js version
docker run flux-atlas:latest node --version
```

### Network connectivity issues
- Verify `FLUX_SEED_NODE` is accessible
- Check firewall rules for outbound HTTPS
- Increase `RPC_TIMEOUT` for slow networks

## Backup and Restore

The application is stateless and doesn't require backups. Configuration is managed via environment variables.

## Monitoring

### Prometheus Metrics (Future Enhancement)
The health endpoint can be scraped by Prometheus:

```yaml
scrape_configs:
  - job_name: 'flux-atlas'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/healthz'
```

### Grafana Dashboard
Monitor:
- Memory usage trends
- Build duration
- Node/edge counts over time
- API request rates

## Support

For issues or questions:
- GitHub Issues: <repository-url>/issues
- Flux Discord: https://discord.gg/flux

## License

[Specify your license here]
