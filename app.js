require('./tracing');
const express = require('express');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------------
// Prometheus Metrics Setup
// -------------------------
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

// -------------------------
// Middleware
// -------------------------
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : req.path,
      status: res.statusCode
    });
  });
  next();
});

// -------------------------
// Routes
// -------------------------

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP' });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// Root endpoint
app.get('/', (req, res) => {
  res.send('Sample App is running 🚀');
});

// -------------------------
// Start Server
// -------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
