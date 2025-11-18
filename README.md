# Flux Network Atlas

Flux Network Atlas is a real-time network visualization and analysis tool designed for the Flux blockchain ecosystem. It provides a comprehensive view of node topology, bandwidth metrics, and network health through an interactive WebGL interface.

## Key Capabilities

### Network Topology Visualization
- **High-Performance Rendering**: Utilizes Sigma.js and WebGL to render thousands of nodes and connections with 60fps performance.
- **Intelligent Clustering**: Automatically groups nodes sharing identical IP addresses (UPnP clusters) to reduce visual clutter and represent physical network topology accurately.
- **Force-Directed Layout**: Employs d3-force algorithms to position nodes based on connection density, centrality, and bandwidth metrics.

### Network Metrics & Analysis
- **Real-Time Telemetry**: Monitors total node count, edge connections, and ArcaneOS adoption rates.
- **Bandwidth Monitoring**: Visualizes download and upload throughput across the network.
- **Centrality Computation**: Identifies critical network hubs and bridge nodes using graph centrality algorithms.
- **Tier Distribution**: Analyzes the distribution of CUMULUS, NIMBUS, and STRATUS node tiers.

### Automated Synchronization
- **State Persistence**: Maintains graph state between rebuilds to ensure continuity.
- **Background Polling**: Performs non-disruptive updates in 30-minute intervals.
- **Event-Driven Updates**: Notifies connected clients immediately when new network data is available.

## System Architecture

The application follows a decoupled client-server architecture:

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

### Technical Stack

**Frontend**
- **Core**: React 19, TypeScript
- **Visualization**: Sigma.js 3, Graphology
- **State Management**: React Hooks

**Backend**
- **Runtime**: Node.js, Express 5
- **Computation**: d3-force (layout simulation)
- **Security**: Helmet, Express Rate Limit
- **Language**: TypeScript

## Quick Start

### Prerequisites
- Node.js 20 or higher
- npm or yarn package manager
- Docker (optional, for containerized deployment)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Sikbik/Flux_Atlas.git
   cd Flux_Atlas
   ```

2. **Install dependencies**
   ```bash
   # Install backend dependencies
   cd backend
   npm install

   # Install frontend dependencies
   cd ../frontend
   npm install
   ```

3. **Configure environment**
   ```bash
   cd backend
   cp .env.example .env
   # Modify .env with appropriate settings
   ```

4. **Start development servers**
   ```bash
   # Terminal 1: Start Backend
   cd backend
   npm run dev

   # Terminal 2: Start Frontend
   cd frontend
   npm run dev
   ```

5. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:4000

## Configuration

The backend service is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FLUX_UPDATE_INTERVAL` | `1800000` | Network rebuild interval in milliseconds (30 mins) |
| `FLUX_SEED_NODE` | `https://api.runonflux.io` | Primary Flux API endpoint for initial discovery |
| `RPC_TIMEOUT` | `10000` | Timeout for node RPC calls (ms) |
| `MAX_CONCURRENT_FETCHES` | `50` | Maximum number of concurrent network requests |
| `LAYOUT_NODE_CAP` | `5000` | Maximum number of nodes included in force-directed simulation |

## Project Structure

```
Flux_Atlas/
├── backend/
│   ├── src/
│   │   ├── config/          # Environment and runtime configuration
│   │   ├── http/            # Express server and middleware
│   │   ├── services/        # Core business logic (AtlasBuilder, FluxAPI)
│   │   ├── types/           # TypeScript type definitions
│   │   └── utils/           # Shared utilities
│   └── dist/                # Compiled JavaScript output
├── frontend/
│   ├── src/
│   │   ├── components/      # React UI components
│   │   ├── hooks/           # Custom state management hooks
│   │   ├── utils/           # Frontend utilities
│   │   └── types.ts         # Shared type definitions
│   └── dist/                # Production build artifacts
├── Dockerfile               # Multi-stage Docker build definition
└── docker-compose.yml       # Container orchestration configuration
```

## System Operation

1. **Data Collection**: The system queries the Flux API to retrieve the active node list, peer connections, and benchmark data.
2. **Graph Construction**: Nodes and edges are instantiated. UPnP clusters are identified and normalized to prevent topology distortion.
3. **Layout Simulation**: A physics-based simulation (d3-force) positions nodes. High-weight nodes are distributed to optimize visual clarity.
4. **Visualization**: The frontend renders the computed graph state using WebGL, supporting interactive exploration.

## API Reference

### `GET /api/state`
Retrieves the current state of the network atlas.

**Response:**
```json
{
  "building": false,
  "data": {
    "buildId": "uuid-string",
    "nodes": [],
    "edges": [],
    "stats": {
      "totalNodes": 1000,
      "totalEdges": 5000
    },
    "meta": {
      "timestamp": "ISO-8601"
    }
  }
}
```

### `GET /healthz`
System health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "memory": {
    "heapUsed": 245,
    "heapTotal": 312
  }
}
```

## Performance & Security

- **Optimization**: Implements multi-stage Docker builds, deterministic random seeding, and efficient edge distribution algorithms.
- **Rendering**: WebGL-based rendering ensures 60fps performance with datasets exceeding 8,000 nodes.
- **Security**: Protected via Helmet.js headers, CORS policies, and IP-based rate limiting.

## Deployment

For production deployment instructions, including Docker configuration and Flux marketplace setup, refer to [DEPLOYMENT.md](./DEPLOYMENT.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Support

- **Issue Tracking**: [GitHub Issues](https://github.com/Sikbik/Flux_Atlas/issues)
- **Community**: [Flux Discord](https://discord.com/invite/runonflux)
