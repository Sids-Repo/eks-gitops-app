const express = require('express');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-grpc');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { logs } = require('@opentelemetry/api-logs');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

// Enable diagnostic logging for debugging
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_NAME = 'sample-app';

// Initialize tracing
const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
});

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.observability:4317',
});

provider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
provider.register();

// Initialize logging
const loggerProvider = new LoggerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
  }),
});

const logExporter = new OTLPLogExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.observability:4317',
});

loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
logs.setGlobalLoggerProvider(loggerProvider);
const logger = logs.getLogger(SERVICE_NAME);

// Initialize metrics
const meterProvider = new MeterProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
  }),
});

const metricExporter = new OTLPMetricExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.observability:4317',
});

meterProvider.addMetricReader(new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60000,
}));

const meter = meterProvider.getMeter(SERVICE_NAME);
const requestCounter = meter.createCounter('http.requests.total', {
  description: 'Total number of HTTP requests',
});
const requestDuration = meter.createHistogram('http.request.duration', {
  description: 'HTTP request duration in seconds',
  unit: 's',
});

app.use(express.json());

// Middleware to trace requests
app.use((req, res, next) => {
  const tracer = require('@opentelemetry/api').trace.getTracer(SERVICE_NAME);
  const span = tracer.startSpan(`${req.method} ${req.path}`);
  const startTime = Date.now();
  
  span.setAttribute('http.method', req.method);
  span.setAttribute('http.url', req.url);
  span.setAttribute('http.host', req.hostname);
  
  // Add request ID for log correlation
  req.id = Math.random().toString(36).substring(7);
  
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    
    span.setAttribute('http.status_code', res.statusCode);
    span.setAttribute('http.duration', duration);
    span.end();
    
    requestCounter.add(1, {
      'http.method': req.method,
      'http.status_code': res.statusCode,
      'http.path': req.path,
    });
    
    requestDuration.record(duration, {
      'http.method': req.method,
      'http.status_code': res.statusCode,
      'http.path': req.path,
    });
    
    // Log the request
    logger.emit({
      body: JSON.stringify({
        message: `Request ${req.method} ${req.path} completed in ${duration}s`,
        requestId: req.id,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: duration,
        timestamp: new Date().toISOString()
      }),
      severityNumber: res.statusCode >= 400 ? 17 : 9, // 17=ERROR, 9=INFO
      severityText: res.statusCode >= 400 ? 'ERROR' : 'INFO',
      attributes: {
        'http.method': req.method,
        'http.path': req.path,
        'http.status_code': res.statusCode,
        'request.id': req.id,
        'trace.id': span.spanContext().traceId,
        'span.id': span.spanContext().spanId,
      },
    });
  })  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'sample-app'
  });
});

// Sample endpoint that might fail sometimes
app.get('/api/data', (req, res) => {
  const tracer = require('@opentelemetry/api').trace.getTracer('sample-app');
  
  tracer.startActiveSpan('process-data', async (span) => {
    try {
      // Simulate some processing
      const shouldFail = Math.random() < 0.1; // 10% chance of failure
      
      if (shouldFail) {
        span.setAttribute('error', true);
        span.setAttribute('error.message', 'Random failure occurred');
        span.recordException(new Error('Random failure'));
        
        res.status(500).json({ 
          error: 'Random failure occurred',
          requestId: req.id 
        });
      } else {
        // Simulate database query
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        span.setAttribute('data.records', 5);
        
        res.json({ 
          message: 'Hello from GitOps demo!', 
          data: [1, 2, 3, 4, 5],
          requestId: req.id,
          timestamp: new Date().toISOString()
        });
      }
      span.end();
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      span.end();
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

// Endpoint that calls another service (simulated)
app.get('/api/chain', async (req, res) => {
  const tracer = require('@opentelemetry/api').trace.getTracer('sample-app');
  
  await tracer.startActiveSpan('call-internal-service', async (span) => {
    try {
      // Simulate calling another service
      span.setAttribute('service.called', 'internal-service');
      span.addEvent('calling internal service');
      
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
      
      span.addEvent('internal service responded');
      
      // Simulate database operation
      const dbSpan = tracer.startSpan('database-query', {
        attributes: {
          'db.system': 'memory',
          'db.operation': 'select',
          'db.table': 'users'
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 20));
      dbSpan.end();
      
      span.setAttribute('chain.completed', true);
      
      res.json({ 
        message: 'Chain completed successfully',
        traceId: span.spanContext().traceId,
        requestId: req.id,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
      res.status(500).json({ error: 'Chain failed' });
    } finally {
      span.end();
    }
  });
});

// Endpoint that returns traces for demonstration
app.get('/api/trace-demo', async (req, res) => {
  const tracer = require('@opentelemetry/api').trace.getTracer('sample-app');
  
  await tracer.startActiveSpan('trace-demo', async (parentSpan) => {
    try {
      parentSpan.setAttribute('demo.type', 'distributed-trace');
      
      // Simulate multiple operations
      const operations = ['auth', 'validation', 'business-logic', 'data-fetch'];
      
      for (const op of operations) {
        await tracer.startActiveSpan(`operation-${op}`, async (childSpan) => {
          childSpan.setAttribute('operation.name', op);
          childSpan.addEvent(`starting ${op}`);
          
          await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
          
          childSpan.addEvent(`completed ${op}`);
          childSpan.end();
        });
      }
      
      res.json({
        message: 'Trace demo completed',
        traceId: parentSpan.spanContext().traceId,
        operations: operations,
        timestamp: new Date().toISOString()
      });
    } finally {
      parentSpan.end();
    }
  });
});

// Metrics endpoint (for Prometheus scraping)
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(`
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{service="sample-app"} ${Math.floor(Math.random() * 1000)}
# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1",service="sample-app"} ${Math.floor(Math.random() * 50)}
http_request_duration_seconds_bucket{le="0.5",service="sample-app"} ${Math.floor(Math.random() * 100)}
http_request_duration_seconds_bucket{le="1",service="sample-app"} ${Math.floor(Math.random() * 150)}
http_request_duration_seconds_bucket{le="+Inf",service="sample-app"} ${Math.floor(Math.random() * 200)}
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logger.emit({
    body: JSON.stringify({
      message: `Server started on port ${PORT}`,
      service: 'sample-app',
      port: PORT,
      timestamp: new Date().toISOString()
    }),
    severityNumber: 9, // INFO
    severityText: 'INFO',
    attributes: {
      'service.name': 'sample-app',
      'service.port': PORT,
    },
  });
});;
