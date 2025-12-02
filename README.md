# IBP GeoDNS API Prometheus Exporter

A Prometheus exporter for the IBP (Interweb Blockchain Providers) GeoDNS API that tracks member and service status.

## Features

- Tracks member status (active/inactive)
- Tracks service status (up/down) based on downtime events
- Exposes Prometheus metrics at `/:memberId/metrics`
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

The application will start on port 3000 by default.

## Usage

### Metrics Endpoint

Access metrics for a specific member:

```
GET http://localhost:3000/:memberId/metrics
```

Example:
```
GET http://localhost:3000/Gatotech/metrics
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

Add this to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'ibp-geodns-exporter'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/Gatotech/metrics'  # Change to desired member
```

Or scrape multiple members:

```yaml
scrape_configs:
  - job_name: 'ibp-geodns-exporter'
    static_configs:
      - targets: ['localhost:3000']
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_member
      - source_labels: [__param_member]
        target_label: instance
      - target_label: __address__
        replacement: localhost:3000
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

