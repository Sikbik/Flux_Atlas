# Flux Atlas Deployment Guide

## Overview
Flux Atlas is a network visualization tool for the Flux blockchain. This guide covers deployment options for running the application on Flux nodes or standard Docker environments.

## Prerequisites
- Docker Engine installed
- Minimum 2GB RAM available
- Port 3000 available (serves both frontend and backend API)

## Quick Start with Docker

### Option 1: Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/Sikbik/Flux_Atlas.git
cd Flux_Atlas

# Start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

### Option 2: Using Docker CLI

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

You can configure the application by editing `docker-compose.yml` or passing environment variables via Docker `-e` flags:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment mode |
| `PORT` | `3000` | Server port (serves both frontend and API) |
| `FLUX_UPDATE_INTERVAL` | `1800000` | Network rebuild interval in milliseconds (30 min) |
| `FLUX_SEED_NODE` | `https://api.runonflux.io` | Primary Flux API endpoint |
| `RPC_TIMEOUT` | `10000` | Timeout for RPC requests (ms) |
| `MAX_CONCURRENT_FETCHES` | `50` | Maximum concurrent node fetch requests |
| `LAYOUT_SEED` | `flux-atlas-2024` | Seed for deterministic graph layout |
| `LAYOUT_NODE_CAP` | `5000` | Maximum nodes included in force-directed layout |
| `FLUX_INCLUDE_EXTERNAL_PEERS` | `false` | Whether to include external peers in the graph |
| `RPC_PROTOCOL` | `http` | Protocol for node RPC connections |
| `RPC_PORT` | `16127` | Port for node RPC connections |

### Customizing Rebuild Interval

For production environments on Flux, the recommended interval is 30 minutes:

```yaml
environment:
  - FLUX_UPDATE_INTERVAL=1800000  # 30 minutes
```

For testing or development, shorter intervals may be used:

```yaml
environment:
  - FLUX_UPDATE_INTERVAL=600000  # 10 minutes
```

## Accessing the Application

Once the container is running, the application is accessible at:
- **Web Interface**: http://localhost:3000
- **API State Endpoint**: http://localhost:3000/api/state
- **Health Check**: http://localhost:3000/healthz

## Health Monitoring

The `/healthz` endpoint provides real-time system status, including:
- Service health status
- Uptime duration
- Memory usage statistics
- Current node and edge counts
- Timestamp of the last successful build

**Example Response:**
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

1. **Build and Push Docker Image**:
   ```bash
   docker build -t your-dockerhub-username/flux-atlas:latest .
   docker push your-dockerhub-username/flux-atlas:latest
   ```

2. **Create Flux App Specification**:
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
   - Navigate to the **Flux Apps** section in FluxOS.
   - Click **Register New App**.
   - Paste the specification JSON.
   - Complete the registration fee payment.
   - Await network acceptance.

### Resource Requirements

| Tier | CPU | RAM | HDD | Usage Scenario |
|------|-----|-----|-----|----------------|
| Minimum | 0.5 vCPU | 1GB | 3GB | Development / Testing |
| Recommended | 1 vCPU | 2GB | 5GB | Production |
| Optimal | 2 vCPU | 4GB | 10GB | High Traffic |

## Production Optimizations

### Security
- **Helmet.js**: Enabled to set secure HTTP headers.
- **CORS**: Configured to manage cross-origin resource sharing.
- **Rate Limiting**: Enforces a limit of 100 requests per minute per IP address.

### Performance
- **Compression**: Gzip compression is enabled for all HTTP responses.
- **Payload Limits**: JSON payloads are limited to 1MB to prevent abuse.
- **Docker Optimization**: Uses multi-stage builds to minimize final image size.

### Reliability
- **Health Checks**: Configured to run every 30 seconds.
- **Auto-Restart**: Containers are set to restart automatically on failure.
- **Error Handling**: Implements graceful error handling and structured logging.

## Troubleshooting

### Container Fails to Start
```bash
# Check container logs for errors
docker logs flux-atlas

# Verify port availability
netstat -tuln | grep 3000
```

### High Memory Usage
- Reduce `LAYOUT_NODE_CAP` if processing a very large network graph.
- Increase the memory limit in the Docker configuration.
- Monitor usage trends via the `/healthz` endpoint.

### Build Failures
```bash
# Rebuild without using cache
docker build --no-cache -t flux-atlas:latest .

# Verify Node.js version in container
docker run flux-atlas:latest node --version
```

### Network Connectivity Issues
- Ensure `FLUX_SEED_NODE` is reachable from the container.
- Check firewall rules for outbound HTTPS traffic.
- Increase `RPC_TIMEOUT` if operating on a slow network connection.

## Backup and Restore

The application is designed to be stateless. No data backup is required as the network graph is rebuilt from live chain data. Configuration is managed entirely via environment variables.

## Support

For issues, questions, or contributions:
- **GitHub Issues**: [https://github.com/Sikbik/Flux_Atlas/issues](https://github.com/Sikbik/Flux_Atlas/issues)
- **Flux Discord**: [https://discord.com/invite/runonflux](https://discord.com/invite/runonflux)

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
