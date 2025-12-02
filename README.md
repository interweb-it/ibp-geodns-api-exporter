# IBP GeoDNS API Prometheus Exporter

A Prometheus exporter for the IBP (Interweb Blockchain Providers) GeoDNS API that tracks member and service status.

## Features

- Tracks member status (active/inactive)
- Tracks service status (up/down) based on downtime events
- Exposes Prometheus metrics at `/metrics` (all members) and `/:memberId/metrics` (specific member)
- Fetches real-time data from the IBP dashboard API

## Installation

```bash
yarn install
```

## Running the Application

### Development

```bash
yarn start:dev
```

### Production

```bash
yarn build
yarn start:prod
```

### Production with PM2

```bash
# Build the application
yarn build

# Start with PM2
yarn pm2:start

# Other PM2 commands
yarn pm2:stop      # Stop the application
yarn pm2:restart   # Restart the application
yarn pm2:logs      # View logs
yarn pm2:monit     # Monitor the application
yarn pm2:delete    # Delete from PM2
```

The application will start on port 3000 by default.

## Usage

### Metrics Endpoints

Access metrics for all members:

```
GET http://localhost:3000/metrics
```

Access metrics for a specific member:

```
GET http://localhost:3000/:memberId/metrics
```

Examples:
```
GET http://localhost:3000/metrics
GET http://localhost:3000/Gatotech/metrics
GET http://localhost:3000/Interweb/metrics
```

### Available Metrics

#### `ibp_member_status`
Gauge metric indicating member status.
- `1` = Active/Up
- `0` = Inactive/Down

Labels:
- `member`: Member name
- `region`: Member region

#### `ibp_service_status`
Gauge metric indicating service status.
- `1` = Up
- `0` = Down

Labels:
- `member`: Member name
- `service`: Service name (e.g., "Polkadot", "Kusama")
- `domain`: Domain name (e.g., "eth-asset-hub-polkadot.ibp.network")
- `check_type`: Type of check (e.g., "endpoint")
- `check_name`: Name of check (e.g., "ethrpc")

#### `ibp_downtime_events_total`
Counter metric tracking total downtime events.

Labels:
- `member`: Member name
- `service`: Service name
- `domain`: Domain name
- `check_type`: Type of check
- `check_name`: Name of check
- `status`: Event status (e.g., "ongoing", "resolved")

## Configuration

The exporter fetches data from:
- Members API: `https://ibdash.dotters.network:9000/api/members`
- Downtime Events API: `https://ibdash.dotters.network:9000/api/downtime/events`

The downtime events are fetched for the last 30 days by default.

## Prometheus Configuration

### Scrape All Members (Recommended)

Add this to your `prometheus.yml` to scrape metrics for all members:

```yaml
scrape_configs:
  - job_name: 'ibp-geodns-exporter'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

### Scrape Specific Member

To scrape metrics for a specific member:

```yaml
scrape_configs:
  - job_name: 'ibp-geodns-exporter'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/Gatotech/metrics'  # Change to desired member
```

### Scrape Multiple Specific Members

To scrape multiple specific members:

```yaml
scrape_configs:
  - job_name: 'ibp-geodns-exporter'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/Interweb/metrics'
  - job_name: 'ibp-geodns-exporter-gatotech'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/Gatotech/metrics'
```

## Development

### Project Structure

```
src/
├── main.ts                 # Application entry point
├── app.module.ts          # Root module
└── metrics/
    ├── metrics.module.ts  # Metrics module
    ├── metrics.controller.ts  # HTTP controller
    ├── metrics.service.ts     # Metrics logic
    └── api-client.service.ts  # API client for IBP dashboard
```

## License

MIT

