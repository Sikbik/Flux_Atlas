import { useState, useEffect, useRef, useCallback } from 'react';
import './LandingPage.css';

export type ViewMode = '2d' | '3d';

interface LandingPageProps {
  onSelectView: (mode: ViewMode) => void;
  isLoading?: boolean;
  nodeCount?: number;
  onDataReady?: () => void; // Callback when data becomes available
}

// Particle system for background effect
const ParticleCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const particlesRef = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    opacity: number;
    hue: number;
  }>>([]);

  const initParticles = useCallback((width: number, height: number) => {
    const count = Math.min(150, Math.floor((width * height) / 8000));
    particlesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.5 + 0.2,
      hue: Math.random() > 0.7 ? 280 : 185, // Cyan or purple
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particlesRef.current.forEach((p, i) => {
        // Update position
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around edges
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.opacity})`;
        ctx.fill();

        // Draw connections to nearby particles
        particlesRef.current.slice(i + 1).forEach((p2) => {
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `hsla(190, 100%, 60%, ${0.15 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        });
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [initParticles]);

  return <canvas ref={canvasRef} className="landing-particles-canvas" />;
};

// Animated counter component
const AnimatedCounter = ({ value, duration = 2000 }: { value: number; duration?: number }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);

      // Easing function for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * value));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration]);

  return <>{count.toLocaleString()}</>;
};

export const LandingPage = ({ onSelectView, nodeCount, onDataReady }: LandingPageProps) => {
  const [hoveredCard, setHoveredCard] = useState<ViewMode | null>(null);
  const [animationPhase, setAnimationPhase] = useState(0);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [polledStats, setPolledStats] = useState<{ nodes: number; appInstances: number } | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Connecting to Flux network...');

  // Fetch app instances from Flux API
  useEffect(() => {
    let cancelled = false;

    const fetchAppInstances = async () => {
      try {
        const response = await fetch('https://api.runonflux.io/apps/globalappsspecifications');
        if (!response.ok) return;

        const data = await response.json();
        if (data.status === 'success' && Array.isArray(data.data)) {
          const totalInstances = data.data.reduce(
            (total: number, app: { instances?: number }) => total + (app.instances || 0),
            0
          );
          if (!cancelled) {
            setPolledStats(prev => ({ ...prev, nodes: prev?.nodes || 0, appInstances: totalInstances }));
          }
        }
      } catch (err) {
        console.error('App instances fetch error:', err);
      }
    };

    fetchAppInstances();
  }, []);

  // Poll for node data when not yet available
  useEffect(() => {
    // If we already have node data from props, use it
    if (nodeCount) {
      setPolledStats(prev => ({ nodes: nodeCount, appInstances: prev?.appInstances || 0 }));
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) return;

        const status = await response.json();

        if (status.building) {
          // Show progress if available
          if (status.progress) {
            const stage = status.progress.stage || 'Building';
            // Progress is already a percentage (0-100), not a decimal
            const pct = Math.round(status.progress.progress || 0);
            setLoadingMessage(`${stage} ${pct}%`);
          } else {
            setLoadingMessage('Scanning network topology...');
          }
        } else if (status.buildId) {
          // Build complete, fetch full state
          setLoadingMessage('Loading atlas data...');
          const stateResponse = await fetch('/api/state');
          if (stateResponse.ok) {
            const state = await stateResponse.json();
            if (state.data?.stats) {
              setPolledStats(prev => ({
                nodes: state.data.stats.totalFluxNodes,
                appInstances: prev?.appInstances || 0,
              }));
              // Notify parent to refresh its state
              onDataReady?.();
            }
          }
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    };

    // Poll immediately and then every 2 seconds
    pollStatus();
    const interval = setInterval(() => {
      if (!cancelled) pollStatus();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [nodeCount, onDataReady]);

  useEffect(() => {
    // Staggered entrance animation
    const timers = [
      setTimeout(() => setAnimationPhase(1), 100),
      setTimeout(() => setAnimationPhase(2), 400),
      setTimeout(() => setAnimationPhase(3), 700),
      setTimeout(() => setAnimationPhase(4), 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Track mouse for parallax effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({
        x: (e.clientX / window.innerWidth - 0.5) * 20,
        y: (e.clientY / window.innerHeight - 0.5) * 20,
      });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Use polled stats if props aren't available
  const effectiveNodeCount = nodeCount || polledStats?.nodes;
  const effectiveAppInstances = polledStats?.appInstances;
  const dataReady = effectiveNodeCount && effectiveAppInstances;

  return (
    <div className="landing">
      {/* Layered background */}
      <div className="landing__bg">
        <div className="landing__bg-base" />
        <div
          className="landing__bg-gradient"
          style={{
            transform: `translate(${mousePos.x * 0.5}px, ${mousePos.y * 0.5}px)`,
          }}
        />
        <div className="landing__bg-grid" />
        <div className="landing__bg-noise" />
        <ParticleCanvas />
        <div className="landing__bg-vignette" />
      </div>

      {/* Floating orbs */}
      <div
        className="landing__orb landing__orb--1"
        style={{ transform: `translate(${mousePos.x * -1}px, ${mousePos.y * -1}px)` }}
      />
      <div
        className="landing__orb landing__orb--2"
        style={{ transform: `translate(${mousePos.x * 0.8}px, ${mousePos.y * 0.8}px)` }}
      />
      <div
        className="landing__orb landing__orb--3"
        style={{ transform: `translate(${mousePos.x * -0.5}px, ${mousePos.y * -0.5}px)` }}
      />

      {/* Main content */}
      <main className="landing__content">
        {/* Header */}
        <header className={`landing__header ${animationPhase >= 1 ? 'visible' : ''}`}>
          <div className="landing__logo-wrap">
            <img
              src="/Flux_symbol_blue-white.png"
              alt="Flux"
              className="landing__logo"
            />
            <div className="landing__logo-glow" />
          </div>

          <h1 className="landing__title">
            <span className="landing__title-line">
              <span className="landing__title-word landing__title-word--flux">Flux</span>
            </span>
            <span className="landing__title-line">
              <span className="landing__title-word landing__title-word--network">Network</span>
              <span className="landing__title-word landing__title-word--atlas">Atlas</span>
            </span>
          </h1>

          <p className="landing__tagline">
            <span className="landing__tagline-line">Visualize the decentralized future.</span>
            <span className="landing__tagline-line">Explore the living network.</span>
          </p>
        </header>

        {/* Live Stats */}
        <section className={`landing__stats ${animationPhase >= 2 ? 'visible' : ''}`}>
          {dataReady ? (
            <>
              <div className="landing__stat">
                <div className="landing__stat-value">
                  <AnimatedCounter value={effectiveNodeCount!} />
                </div>
                <div className="landing__stat-label">Active Nodes</div>
              </div>

              <div className="landing__stat-divider">
                <svg viewBox="0 0 24 60" className="landing__stat-divider-svg">
                  <path d="M12 0 L12 60" stroke="url(#dividerGradient)" strokeWidth="1" />
                  <circle cx="12" cy="30" r="3" fill="var(--color-accent)" />
                  <defs>
                    <linearGradient id="dividerGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="transparent" />
                      <stop offset="50%" stopColor="var(--color-accent)" />
                      <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <div className="landing__stat">
                <div className="landing__stat-value">
                  <AnimatedCounter value={effectiveAppInstances!} />
                </div>
                <div className="landing__stat-label">App Instances</div>
              </div>
            </>
          ) : (
            <div className="landing__stat landing__stat--loading">
              <div className="landing__stat-loader">
                <div className="landing__stat-loader-ring" />
                <div className="landing__stat-loader-ring" />
                <div className="landing__stat-loader-ring" />
              </div>
              <span className="landing__stat-loading-text">
                {loadingMessage}
              </span>
            </div>
          )}
        </section>

        {/* View Selection */}
        <section className={`landing__views ${animationPhase >= 3 ? 'visible' : ''}`}>
          <h2 className="landing__views-title">
            <span className="landing__views-title-text">Choose Your Perspective</span>
            <span className="landing__views-title-line" />
          </h2>

          <div className="landing__cards">
            {/* 2D Card */}
            <button
              className={`landing__card ${hoveredCard === '2d' ? 'hovered' : ''} ${!dataReady ? 'disabled' : ''}`}
              onClick={() => dataReady && onSelectView('2d')}
              onMouseEnter={() => setHoveredCard('2d')}
              onMouseLeave={() => setHoveredCard(null)}
              disabled={!dataReady}
            >
              <div className="landing__card-bg" />
              <div className="landing__card-border" />

              <div className="landing__card-icon">
                <svg viewBox="0 0 80 80" className="landing__card-icon-svg">
                  {/* Animated 2D network visualization */}
                  <defs>
                    <filter id="glow2d">
                      <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <g filter="url(#glow2d)">
                    {/* Grid lines */}
                    <line x1="10" y1="40" x2="70" y2="40" stroke="var(--color-accent)" strokeWidth="0.5" opacity="0.3" />
                    <line x1="40" y1="10" x2="40" y2="70" stroke="var(--color-accent)" strokeWidth="0.5" opacity="0.3" />
                    {/* Connection lines */}
                    <line x1="20" y1="25" x2="40" y2="40" stroke="var(--color-accent)" strokeWidth="1" opacity="0.6" className="landing__card-line" />
                    <line x1="60" y1="25" x2="40" y2="40" stroke="var(--color-accent)" strokeWidth="1" opacity="0.6" className="landing__card-line" />
                    <line x1="25" y1="55" x2="40" y2="40" stroke="var(--color-accent)" strokeWidth="1" opacity="0.6" className="landing__card-line" />
                    <line x1="55" y1="55" x2="40" y2="40" stroke="var(--color-accent)" strokeWidth="1" opacity="0.6" className="landing__card-line" />
                    <line x1="20" y1="25" x2="60" y2="25" stroke="var(--color-accent)" strokeWidth="0.5" opacity="0.4" className="landing__card-line" />
                    <line x1="25" y1="55" x2="55" y2="55" stroke="var(--color-accent)" strokeWidth="0.5" opacity="0.4" className="landing__card-line" />
                    {/* Nodes */}
                    <circle cx="20" cy="25" r="5" fill="#4da6ff" className="landing__card-node" />
                    <circle cx="60" cy="25" r="5" fill="#b388ff" className="landing__card-node" />
                    <circle cx="25" cy="55" r="4" fill="#ff8f4d" className="landing__card-node" />
                    <circle cx="55" cy="55" r="4" fill="#4da6ff" className="landing__card-node" />
                    <circle cx="40" cy="40" r="8" fill="var(--color-accent)" className="landing__card-node landing__card-node--center" />
                  </g>
                </svg>
              </div>

              <h3 className="landing__card-title">2D Topographic</h3>

              <p className="landing__card-desc">
                Classic bird's-eye view optimized for deep analysis. Lightning-fast rendering with precise node selection.
              </p>

              <ul className="landing__card-features">
                <li>
                  <svg viewBox="0 0 16 16" className="landing__card-feature-icon">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <span>Instant Performance</span>
                </li>
                <li>
                  <svg viewBox="0 0 16 16" className="landing__card-feature-icon">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <span>Network Analysis</span>
                </li>
                <li>
                  <svg viewBox="0 0 16 16" className="landing__card-feature-icon">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <span>Precise Selection</span>
                </li>
              </ul>

              <div className="landing__card-cta">
                <span>Enter 2D View</span>
                <svg viewBox="0 0 24 24" className="landing__card-cta-arrow">
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>

            {/* 3D Card */}
            <button
              className={`landing__card landing__card--3d ${hoveredCard === '3d' ? 'hovered' : ''} ${!dataReady ? 'disabled' : ''}`}
              onClick={() => dataReady && onSelectView('3d')}
              onMouseEnter={() => setHoveredCard('3d')}
              onMouseLeave={() => setHoveredCard(null)}
              disabled={!dataReady}
            >
              <div className="landing__card-bg" />
              <div className="landing__card-border" />
              <div className="landing__card-badge">Immersive</div>

              <div className="landing__card-icon">
                <svg viewBox="0 0 80 80" className="landing__card-icon-svg landing__card-icon-svg--3d">
                  <defs>
                    <filter id="glow3d">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <g filter="url(#glow3d)">
                    {/* 3D orbital rings */}
                    <ellipse cx="40" cy="40" rx="28" ry="10" fill="none" stroke="var(--color-accent)" strokeWidth="0.8" opacity="0.4" className="landing__card-orbit landing__card-orbit--1" />
                    <ellipse cx="40" cy="40" rx="28" ry="10" fill="none" stroke="#b388ff" strokeWidth="0.8" opacity="0.4" transform="rotate(60 40 40)" className="landing__card-orbit landing__card-orbit--2" />
                    <ellipse cx="40" cy="40" rx="28" ry="10" fill="none" stroke="#ff8f4d" strokeWidth="0.8" opacity="0.4" transform="rotate(120 40 40)" className="landing__card-orbit landing__card-orbit--3" />
                    {/* Outer nodes */}
                    <circle cx="40" cy="12" r="4" fill="#4da6ff" className="landing__card-node landing__card-node--orbit" />
                    <circle cx="16" cy="52" r="4" fill="#b388ff" className="landing__card-node landing__card-node--orbit" />
                    <circle cx="64" cy="52" r="4" fill="#ff8f4d" className="landing__card-node landing__card-node--orbit" />
                    {/* Center sphere with glow */}
                    <circle cx="40" cy="40" r="12" fill="url(#sphereGradient)" className="landing__card-sphere" />
                    <circle cx="40" cy="40" r="14" fill="none" stroke="var(--color-accent)" strokeWidth="1" opacity="0.5" className="landing__card-sphere-ring" />
                  </g>
                  <defs>
                    <radialGradient id="sphereGradient" cx="35%" cy="35%">
                      <stop offset="0%" stopColor="#61f2ff" />
                      <stop offset="70%" stopColor="var(--color-accent)" />
                      <stop offset="100%" stopColor="#0891b2" />
                    </radialGradient>
                  </defs>
                </svg>
              </div>

              <h3 className="landing__card-title">3D Immersive</h3>

              <p className="landing__card-desc">
                Step inside the network. Navigate through space with full 360° freedom and depth perception.
              </p>

              <ul className="landing__card-features">
                <li>
                  <svg viewBox="0 0 16 16" className="landing__card-feature-icon">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <span>Spatial Navigation</span>
                </li>
                <li>
                  <svg viewBox="0 0 16 16" className="landing__card-feature-icon">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <span>Depth & Perspective</span>
                </li>
                <li>
                  <svg viewBox="0 0 16 16" className="landing__card-feature-icon">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/>
                  </svg>
                  <span>Visual Impact</span>
                </li>
              </ul>

              <div className="landing__card-cta">
                <span>Enter 3D View</span>
                <svg viewBox="0 0 24 24" className="landing__card-cta-arrow">
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer className={`landing__footer ${animationPhase >= 4 ? 'visible' : ''}`}>
          <div className="landing__footer-links">
            <a
              href="https://runonflux.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="landing__footer-link"
            >
              <span>Powered by</span>
              <strong>Flux</strong>
            </a>
            <span className="landing__footer-dot" />
            <a
              href="https://github.com/Sikbik/Flux_Atlas"
              target="_blank"
              rel="noopener noreferrer"
              className="landing__footer-link"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              <span>GitHub</span>
            </a>
          </div>
          <p className="landing__footer-tagline">
            Real-time visualization of the decentralized web
          </p>
        </footer>
      </main>
    </div>
  );
};
