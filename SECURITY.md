# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Security Features

### Backend Security

1. **Helmet.js Security Headers**
   - XSS Protection
   - Content Security Policy
   - DNS Prefetch Control
   - Frame Guard (Clickjacking protection)
   - HSTS (HTTP Strict Transport Security)
   - IE No Open
   - No Sniff
   - Referrer Policy
   - Cross-Origin Resource Policy

2. **Rate Limiting**
   - 100 requests per minute per IP address
   - Prevents DDoS and brute force attacks
   - Returns 429 (Too Many Requests) when exceeded

3. **CORS Configuration**
   - Configurable cross-origin resource sharing
   - Prevents unauthorized cross-domain access

4. **Input Validation**
   - JSON payload size limited to 1MB
   - Prevents memory exhaustion attacks

5. **Environment Variables**
   - No hardcoded credentials
   - All sensitive config via environment variables
   - .env files excluded from version control

### Frontend Security

1. **API Configuration**
   - Configurable API endpoints (no hardcoded URLs)
   - Build-time environment variable injection
   - Default localhost fallback for development

2. **Content Security**
   - No inline scripts
   - External resources from trusted CDNs only
   - No eval() or Function() constructor usage

### Docker Security

1. **Non-Root User**
   - Container runs as `node` user (UID 1000)
   - Follows principle of least privilege

2. **Multi-Stage Build**
   - Minimal production image
   - Development dependencies excluded
   - Reduced attack surface

3. **Health Checks**
   - Automated health monitoring
   - Early detection of service issues

### Dependency Security

- ✅ **Zero Known Vulnerabilities** (as of 2025-10-07)
- Regular `npm audit` checks recommended
- Dependencies from trusted sources only

## Security Best Practices

### For Developers

1. **Never commit secrets**
   ```bash
   # Always use environment variables
   ❌ const API_KEY = "secret-key-123"
   ✅ const API_KEY = process.env.API_KEY
   ```

2. **Keep dependencies updated**
   ```bash
   npm update
   npm audit
   npm audit fix
   ```

3. **Validate environment variables**
   - Check required variables at startup
   - Use sensible defaults
   - Fail fast if critical config missing

4. **Use .env.example for templates**
   ```bash
   # Never commit .env
   cp .env.example .env
   # Edit .env with your values
   ```

### For Deployment

1. **Use specific Docker tags**
   ```bash
   # ❌ Avoid
   docker pull flux-atlas:latest

   # ✅ Prefer
   docker pull flux-atlas:1.0.0
   ```

2. **Limit exposed ports**
   ```bash
   # Only expose necessary ports
   docker run -p 3000:3000 -p 4000:4000 flux-atlas
   ```

3. **Set resource limits**
   ```bash
   docker run --memory="2g" --cpus="2" flux-atlas
   ```

4. **Use secrets management**
   ```bash
   # For sensitive environment variables
   docker secret create api_key api_key.txt
   ```

5. **Regular security updates**
   ```bash
   # Rebuild with latest base images
   docker build --no-cache -t flux-atlas:latest .
   ```

## Reporting a Vulnerability

If you discover a security vulnerability in Flux Network Atlas:

1. **DO NOT** open a public issue
2. Email security concerns to: [your-security-email@domain.com]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: 1-3 days
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next release cycle

### Disclosure Policy

- We follow coordinated vulnerability disclosure
- Public disclosure after fix is released
- Credit given to reporter (if desired)

## Security Checklist

### Before Deployment

- [ ] Environment variables configured (no defaults in production)
- [ ] .env files not committed to repository
- [ ] Dependencies audited (`npm audit`)
- [ ] Docker image scanned for vulnerabilities
- [ ] HTTPS enabled (if exposing publicly)
- [ ] Rate limiting configured appropriately
- [ ] Health checks enabled
- [ ] Logging configured for security events
- [ ] Backup/recovery procedures documented

### Regular Maintenance

- [ ] Monthly dependency updates
- [ ] Quarterly security audits
- [ ] Review access logs for suspicious activity
- [ ] Monitor health check endpoint
- [ ] Update base Docker images

## Known Limitations

1. **No Authentication**
   - Atlas API is read-only
   - Data is public (Flux network info)
   - Consider adding auth if needed for your use case

2. **Rate Limiting is IP-Based**
   - Can be bypassed with proxy/VPN rotation
   - Sufficient for preventing accidental DDoS
   - Not a substitute for full DDoS protection

3. **No Data Encryption at Rest**
   - Application is stateless
   - No persistent data storage
   - All data fetched fresh from Flux network

## Security Contacts

- **Project Maintainer**: [Your Name/GitHub]
- **Security Email**: [your-security-email]
- **GitHub Issues**: https://github.com/Sikbik/Flux_Atlas/issues (for non-sensitive issues only)

## Compliance

This project does not collect or store:
- Personal identifiable information (PII)
- User credentials
- Payment information
- Session data
- Cookies (except for technical operation)

All data displayed is publicly available Flux network information.

---

**Last Updated**: 2025-10-07
