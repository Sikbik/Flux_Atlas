# Flux Network Atlas

A real-time network visualization tool for the Flux blockchain ecosystem. Provides interactive 2D and 3D graph visualization of node topology, peer connections, and network metrics.

## Features

### Visualization
- **Dual Rendering Modes**: Switch between 2D (Sigma.js) and 3D (Three.js) graph views from the landing page
- **WebGL Rendering**: Hardware-accelerated graphics maintaining 60fps with 8,000+ nodes
- **Interactive Tooltips**: Hover over nodes to view IP address, tier, peer counts, and installed applications
- **Node Highlighting**: Search and highlight nodes by IP, payment address, collateral, or application name
- **Intelligent Clustering**: Automatically groups nodes sharing identical IP addresses to reduce visual clutter

### Network Metrics
- **Live Statistics**: Total node count, active connections, and application instances from the Flux network
- **Tier Distribution**: Visual breakdown of CUMULUS, NIMBUS, and STRATUS nodes
- **Centrality Analysis**: Identifies network hubs and bridge nodes using graph algorithms
- **ArcaneOS Tracking**: Monitors ArcaneOS adoption across the network

### User Experience
- **Landing Page**: Clean entry point with 2D/3D view selection and live network statistics
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Touch Controls**: Full gesture support for pan, zoom, and rotate on mobile
- **Color Schemes**: Toggle between tier-based and ArcaneOS-based node coloring

## Architecture

```
Frontend (React 19)          Backend (Express 5)
     │                              │
     │◄────── HTTP/JSON ──────────►│
     │                              │
     │  - GraphCanvas (2D)          │  - Atlas Builder
     │  - GraphCanvas3D             │  - Force Layout (d3-force)
     │  - Landing Page              │  - Flux API Client
     └──────────────────────────────┴──────────► Flux Network API
```

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite, Three.js, Sigma.js |
| Backend | Node.js, Express 5, TypeScript, d3-force |
| Deployment | Docker, Docker Compose |

## Quick Start

### Development

```bash
# Clone repository
git clone https://github.com/Sikbik/Flux_Atlas.git
cd Flux_Atlas

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start development servers
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

Access at http://localhost:5173

### Docker Deployment

```bash
# Using Docker Compose
docker-compose up -d

# Or build manually
docker build -t flux-atlas .
docker run -d -p 3000:3000 flux-atlas
```

Access at http://localhost:3000

### Pre-built Image

```bash
docker pull littlestache/flux-atlas:latest
docker run -d -p 3000:3000 littlestache/flux-atlas:latest
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `FLUX_UPDATE_INTERVAL` | `1800000` | Rebuild interval (ms), default 30 minutes |
| `FLUX_SEED_NODE` | `https://api.runonflux.io` | Primary Flux API endpoint |
| `MAX_CONCURRENT_FETCHES` | `50` | Concurrent network requests |
| `LAYOUT_NODE_CAP` | `5000` | Maximum nodes in force simulation |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/state` | Current graph data (nodes, edges, stats) |
| `GET /api/status` | Build status and progress |
| `GET /healthz` | Health check with memory and uptime |

## Flux Marketplace Deployment

1. Build and push Docker image:
   ```bash
   docker build -t your-username/flux-atlas:latest .
   docker push your-username/flux-atlas:latest
   ```

2. Register app via FluxOS with recommended specs:
   - CPU: 1 vCPU
   - RAM: 2048 MB
   - HDD: 5 GB
   - Port: 3000

## Project Structure

```
Flux_Atlas/
├── backend/
│   └── src/
│       ├── services/       # AtlasBuilder, FluxAPI client
│       ├── http/           # Express server
│       └── types/          # TypeScript definitions
├── frontend/
│   └── src/
│       ├── components/     # React components
│       │   ├── LandingPage.tsx
│       │   ├── GraphCanvas.tsx
│       │   └── GraphCanvas3D.tsx
│       └── hooks/          # State management
├── Dockerfile
└── docker-compose.yml
```

## License

MIT License. See [LICENSE](./LICENSE) for details.

## Support

- Issues: [GitHub Issues](https://github.com/Sikbik/Flux_Atlas/issues)
- Community: [Flux Discord](https://discord.com/invite/runonflux)
