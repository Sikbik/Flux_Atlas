# Flux Network Atlas

A real-time network visualization tool for the Flux blockchain, providing interactive exploration of node topology, bandwidth metrics, and network health.

## Features

### 🗺️ Network Visualization
- **Interactive Graph**: WebGL-powered visualization using Sigma.js
- **UPnP Clustering**: Automatically groups nodes sharing the same IP
- **Weighted Layout**: Positions nodes based on connection count, centrality, and bandwidth
- **Smart Search**: Find nodes by IP address or node address

### 📊 Network Metrics
- **Real-time Stats**: Track total nodes, edges, and ArcaneOS adoption
- **Bandwidth Display**: Shows download/upload speeds (MB/s or GB/s)
- **Centrality Analysis**: Identifies network hubs and critical nodes
- **Tier Distribution**: CUMULUS, NIMBUS, STRATUS breakdown

### 🔄 Auto-Rebuilding
- **Persistent State**: Graph persists between rebuilds
- **30-Minute Intervals**: Automatic network updates
- **Build Notifications**: Alerts when new data is available
- **Background Polling**: Non-disruptive update detection

### 🎨 Visual Design
- **Color Schemes**: Toggle between ArcaneOS status and tier-based coloring
- **Dark Theme**: Eye-friendly interface for extended use
- **Responsive Layout**: Works on desktop and tablet displays
- **Node Details**: Comprehensive sidebar with connection stats and bandwidth

## Architecture

```
┌─────────────┐     HTTP      ┌─────────────┐
│   Frontend  │ ◄────────────► │   Backend   │
│  (React 19) │               │ (Express 5)  │
└─────────────┘               └─────────────┘
                                      │
                                      │ Fetch
                                      ▼
                              ┌─────────────────┐
                              │  Flux API       │
                              │  - Node list    │
                              │  - Peer data    │
                              │  - Benchmarks   │
                              └─────────────────┘
```

### Tech Stack

**Frontend:**
- React 19
- Sigma.js 3 (WebGL graph rendering)
- Graphology (graph data structure)
- TypeScript

**Backend:**
- Express 5
- d3-force (layout algorithm)
- TypeScript
- Helmet (security)
- Express Rate Limit

## Quick Start

### Prerequisites
- Node.js 20+
- npm or yarn
- Docker (for containerized deployment)

### Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/Sikbik/Flux_Atlas.git
cd Flux_Atlas
```

2. **Install dependencies**
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

3. **Configure environment**
```bash
cd backend
cp .env.example .env
# Edit .env with your settings
```

4. **Run development servers**
```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

5. **Access the application**
- Development Frontend: http://localhost:5173
- Development Backend: http://localhost:4000
- Production (Docker): http://localhost:3000 (serves both frontend and API)

### Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions including:
- Docker setup
- Flux marketplace deployment
- Configuration options
- Monitoring and health checks

## Configuration

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLUX_UPDATE_INTERVAL` | `1800000` | Rebuild interval (ms) |
| `FLUX_SEED_NODE` | `https://api.runonflux.io` | Flux API endpoint |
| `RPC_TIMEOUT` | `10000` | Node RPC timeout (ms) |
| `MAX_CONCURRENT_FETCHES` | `50` | Parallel fetch limit |
| `LAYOUT_NODE_CAP` | `5000` | Max nodes for force layout |

## Project Structure

```
Flux_Atlas_js_react_sigma/
├── backend/
│   ├── src/
│   │   ├── config/          # Environment configuration
│   │   ├── http/            # Express server setup
│   │   ├── services/        # Core business logic
│   │   │   ├── atlasBuilder.ts   # Graph building & layout
│   │   │   └── fluxApi.ts        # Flux API client
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # Utilities (logger, network)
│   ├── dist/                # Compiled output
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── utils/           # Utilities (formatting)
│   │   ├── App.tsx          # Main application
│   │   └── types.ts         # TypeScript types
│   ├── dist/                # Build output
│   └── package.json
├── Dockerfile               # Production container
├── docker-compose.yml       # Docker Compose config
└── DEPLOYMENT.md            # Deployment guide
```

## How It Works

### 1. Data Collection
- Fetches node list from Flux API
- Queries each node for peer connections
- Retrieves bandwidth benchmarks
- Collects ArcaneOS status

### 2. Graph Building
- Creates nodes and edges from peer data
- Normalizes UPnP cluster degrees
- Computes centrality metrics
- Calculates composite weights (connections + centrality + bandwidth)

### 3. Layout Algorithm
- Groups nodes by IP (UPnP clusters)
- Applies force-directed layout with d3-force
- Positions high-weight nodes further from center
- Distributes edges randomly across cluster nodes

### 4. Visualization
- Renders graph using Sigma.js WebGL
- Supports pan, zoom, and node selection
- Updates reactively on state changes
- Maintains persistent view between rebuilds

## API Endpoints

### `GET /api/state`
Returns complete atlas state:
```json
{
  "building": false,
  "data": {
    "buildId": "...",
    "nodes": [...],
    "edges": [...],
    "stats": {...},
    "meta": {...}
  }
}
```

### `GET /healthz`
Health check endpoint:
```json
{
  "status": "ok",
  "uptime": 3600,
  "nodes": 8521,
  "edges": 128027,
  "memory": {
    "heapUsed": 245,
    "heapTotal": 312,
    "rss": 389
  }
}
```

## Performance

### Optimizations
- ✅ Multi-stage Docker build (minimal image size)
- ✅ Deterministic random seeding for consistent layouts
- ✅ Edge distribution prevents node hotspots
- ✅ Background polling with minimal API calls
- ✅ WebGL rendering for smooth 60fps visualization
- ✅ Rate limiting (100 req/min per IP)

### Benchmarks
- **Build time**: ~6-7 minutes for 8,500 nodes
- **Memory usage**: ~250-400 MB heap
- **Render performance**: 60 FPS with 8,500 nodes and 130k edges
- **Docker image**: ~200 MB compressed

## Security

- ✅ Helmet.js security headers
- ✅ CORS protection
- ✅ Rate limiting
- ✅ Input validation
- ✅ No exposed secrets
- ✅ Dependency security audits

## Docker Deployment

### Quick Start
```bash
# Using Docker Compose (Recommended)
docker-compose up -d

# Or using Docker directly
docker build -t flux-atlas:latest .
docker run -d -p 3000:3000 --name flux-atlas flux-atlas:latest
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment documentation.

## License

MIT License - See [LICENSE](./LICENSE) file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/Sikbik/Flux_Atlas/issues)
- **Discord**: [Flux Discord](https://discord.com/invite/runonflux)
- **Documentation**: See [DEPLOYMENT.md](./DEPLOYMENT.md)

---

Built with ❤️ for the Flux community
