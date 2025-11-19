# Flux Network Atlas

Flux Network Atlas is a real-time network visualization and analysis tool designed for the Flux blockchain ecosystem. It provides a comprehensive view of node topology, bandwidth metrics, and network health through an interactive 3D visualization interface powered by WebGL technology.

## Key Capabilities

### 3D Network Visualization
- **Immersive 3D Rendering**: Leverages Three.js and react-three-fiber to provide interactive 3D graph visualization, enabling spatial exploration of network topology with intuitive camera controls.
- **Dual Rendering Modes**: Supports both traditional 2D graph layouts (Sigma.js) and advanced 3D spatial visualization, allowing users to choose the optimal view for their analysis needs.
- **High-Performance Graphics**: WebGL-accelerated rendering maintains 60fps performance even with datasets exceeding 8,000 nodes and 40,000 connections.
- **Intelligent Clustering**: Automatically groups nodes sharing identical IP addresses (UPnP clusters) to reduce visual clutter and represent physical network topology accurately.
- **Force-Directed Layout**: Employs d3-force algorithms to position nodes based on connection density, centrality, and bandwidth metrics.
- **Mobile-Optimized Interface**: Fully responsive design with viewport-aware node scaling and gesture-based navigation optimized for touch devices.

### Network Metrics & Analysis
- **Real-Time Telemetry**: Monitors total node count, edge connections, and ArcaneOS adoption rates.
- **Bandwidth Monitoring**: Visualizes download and upload throughput across the network.
- **Centrality Computation**: Identifies critical network hubs and bridge nodes using graph centrality algorithms.
- **Tier Distribution**: Analyzes the distribution of CUMULUS, NIMBUS, and STRATUS node tiers.

### Automated Synchronization
- **State Persistence**: Maintains graph state between rebuilds to ensure continuity.
- **Background Polling**: Performs non-disruptive updates in 30-minute intervals.
- **Event-Driven Updates**: Notifies connected clients immediately when new network data is available.

### User Experience
- **Cross-Platform Support**: Optimized for desktop, tablet, and mobile devices with adaptive layouts.
- **Interactive Controls**: Pan, zoom, and rotate capabilities with mouse, trackpad, and touch gesture support.
- **Dark Theme Interface**: Modern dark-mode design with cyan accent colors for optimal visibility.
- **Floating Action Button**: Mobile-optimized navigation with bottom-sheet sidebar for seamless information access.
- **Search Functionality**: Real-time node search by IP address, payment address, collateral, or application name.

## Atlas 2.0 Features

This release introduces significant enhancements to visualization capabilities and mobile user experience:

- **3D Graph Rendering**: New GraphCanvas3D component provides immersive spatial visualization of network topology using Three.js, enabling users to explore node relationships in three-dimensional space.
- **Viewport-Aware Scaling**: Dynamic node sizing adjusts automatically based on screen dimensions, ensuring optimal clarity across all device types from phones to large displays.
- **Mobile UX Redesign**: Complete mobile interface overhaul featuring floating action button navigation, fullscreen graph layout, and touch-optimized controls.
- **Enhanced Performance**: Optimized rendering pipeline maintains consistent 60fps performance on mobile devices with reduced node scaling factors for smaller viewports.

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
- **Core**: React 19, TypeScript, Vite
- **3D Visualization**: Three.js, react-three-fiber, @react-three/drei
- **2D Visualization**: Sigma.js 3, Graphology
- **State Management**: React Hooks
- **Responsive Design**: CSS Grid, Flexbox, mobile-first architecture

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
- Modern web browser with WebGL 2.0 support (Chrome 56+, Firefox 51+, Safari 15+, Edge 79+)

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
│   │   │   ├── GraphCanvas3D.tsx    # 3D visualization component
│   │   │   ├── GraphCanvas.tsx      # 2D visualization component
│   │   │   ├── Sidebar.tsx          # Network statistics sidebar
│   │   │   └── NodeDetails.tsx      # Node information display
│   │   ├── hooks/           # Custom state management hooks
│   │   ├── utils/           # Frontend utilities
│   │   ├── api/             # API client configuration
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

- **Optimization**: Implements multi-stage Docker builds, deterministic random seeding, and efficient edge distribution algorithms for minimal resource footprint.
- **Advanced Rendering**: Dual-mode WebGL rendering (2D and 3D) maintains 60fps performance with datasets exceeding 8,000 nodes and 40,000 connections.
- **Mobile Performance**: Viewport-aware scaling reduces node density on smaller screens, ensuring smooth performance on mobile devices with limited GPU capabilities.
- **Progressive Enhancement**: Responsive breakpoints at 480px, 640px, 768px, and 1024px provide optimized experiences across the full device spectrum.
- **Security**: Protected via Helmet.js headers, CORS policies, and IP-based rate limiting to prevent abuse and ensure data integrity.

## Deployment

For production deployment instructions, including Docker configuration and Flux marketplace setup, refer to [DEPLOYMENT.md](./DEPLOYMENT.md).

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Support

- **Issue Tracking**: [GitHub Issues](https://github.com/Sikbik/Flux_Atlas/issues)
- **Community**: [Flux Discord](https://discord.com/invite/runonflux)
