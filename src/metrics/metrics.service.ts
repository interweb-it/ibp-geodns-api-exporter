import { Injectable } from '@nestjs/common';
import { Registry, Gauge, Counter } from 'prom-client';
import {
  ApiClientService,
  DowntimeEvent,
  ServiceConfig,
  Member,
} from './api-client.service';

interface CachedMemberData {
  member: Member;
  downtimeEvents: DowntimeEvent[];
  requiredServices: Set<string>;
  servicesConfig: ServiceConfig | null;
  fetchedAt: number; // timestamp in milliseconds
}

@Injectable()
export class MetricsService {
  private readonly registry: Registry;
  private readonly memberStatusGauge: Gauge<string>;
  private readonly serviceStatusGauge: Gauge<string>;
  private readonly downtimeEventCounter: Counter<string>;
  private readonly memberCache: Map<string, CachedMemberData>;
  private readonly cacheTtlMs: number;

  constructor(private readonly apiClient: ApiClientService) {
    this.registry = new Registry();
    this.memberCache = new Map();
    // Cache TTL in milliseconds, default 15 seconds
    this.cacheTtlMs =
      parseInt(process.env.METRICS_CACHE_TTL_SECONDS || '15', 10) * 1000;

    // Gauge for member status (1 = up, 0 = down)
    this.memberStatusGauge = new Gauge({
      name: 'ibp_member_status',
      help: 'IBP member status (1 = active/up, 0 = inactive/down)',
      labelNames: ['member', 'region', 'level'],
      registers: [this.registry],
    });

    // Gauge for service status (1 = up, 0 = down)
    this.serviceStatusGauge = new Gauge({
      name: 'ibp_service_status',
      help: 'IBP service status (1 = up, 0 = down)',
      labelNames: [
        'member',
        'service',
        'domain',
        'check_type',
        'check_name',
        'level',
      ],
      registers: [this.registry],
    });

    // Counter for downtime events
    this.downtimeEventCounter = new Counter({
      name: 'ibp_downtime_events_total',
      help: 'Total number of downtime events',
      labelNames: [
        'member',
        'service',
        'domain',
        'check_type',
        'check_name',
        'status',
      ],
      registers: [this.registry],
    });
  }

  private isCacheValid(memberName: string): boolean {
    const cached = this.memberCache.get(memberName);
    if (!cached) {
      return false;
    }
    const now = Date.now();
    return now - cached.fetchedAt < this.cacheTtlMs;
  }

  private async getCachedOrFetchMemberData(
    memberName: string,
  ): Promise<CachedMemberData> {
    // Check if we have valid cached data
    if (this.isCacheValid(memberName)) {
      const cached = this.memberCache.get(memberName);
      if (cached) {
        return cached;
      }
    }

    // Fetch fresh data from API
    const member = await this.apiClient.getMemberByName(memberName);
    if (!member) {
      throw new Error(`Member ${memberName} not found`);
    }

    // Get downtime events for the last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    let downtimeEvents: DowntimeEvent[] = [];
    try {
      downtimeEvents = await this.apiClient.getDowntimeEvents(
        memberName,
        startDateStr,
        endDateStr,
      );
    } catch (error) {
      console.error(`Error fetching downtime events for ${memberName}:`, error);
    }

    // Get required services for this member's level
    let requiredServices: Set<string> = new Set();
    let servicesConfig: ServiceConfig | null = null;
    try {
      servicesConfig = await this.apiClient.getServicesConfig();
      requiredServices = this.getRequiredServicesByLevel(
        member.level,
        servicesConfig,
      );
    } catch (error) {
      console.error(
        `Error fetching services config for ${member.name}:`,
        error,
      );
    }

    // Store in cache
    const cachedData: CachedMemberData = {
      member,
      downtimeEvents,
      requiredServices,
      servicesConfig,
      fetchedAt: Date.now(),
    };
    this.memberCache.set(memberName, cachedData);

    return cachedData;
  }

  async updateMetricsForMember(memberName: string): Promise<void> {
    // Reset all metrics to ensure we only show data for the requested member
    this.memberStatusGauge.reset();
    this.serviceStatusGauge.reset();
    this.downtimeEventCounter.reset();

    // Get cached or fetch member data
    const cachedData = await this.getCachedOrFetchMemberData(memberName);
    const { member, downtimeEvents, requiredServices } = cachedData;

    // Update member status
    this.memberStatusGauge.set(
      {
        member: member.name,
        region: member.region,
        level: member.level.toString(),
      },
      member.active ? 1 : 0,
    );

    // Track all unique domain/check combinations we've seen
    const trackedCombinations = new Set<string>();
    const servicesWithEvents = new Set<string>();

    // Process downtime events and update metrics
    for (const event of downtimeEvents) {
      const serviceName = this.matchServiceFromDomain(
        event.domain_name,
        member.services,
      );
      const combinationKey = `${event.domain_name}:${event.check_type}:${event.check_name}`;
      trackedCombinations.add(combinationKey);
      servicesWithEvents.add(serviceName);

      // Only process events for the requested member (safety check)
      if (event.member_name !== member.name) {
        continue;
      }

      // Increment downtime event counter
      this.downtimeEventCounter.inc({
        member: member.name,
        service: serviceName,
        domain: event.domain_name,
        check_type: event.check_type,
        check_name: event.check_name,
        status: event.status,
      });

      // Update service status based on event status
      // If status is "ongoing", the service is down (0), otherwise it's up (1)
      const status = event.status === 'ongoing' ? 0 : 1;
      this.serviceStatusGauge.set(
        {
          member: member.name,
          service: serviceName,
          domain: event.domain_name,
          check_type: event.check_type,
          check_name: event.check_name,
          level: member.level.toString(),
        },
        status,
      );
    }

    // For required services that have no downtime events, mark as up
    // (no events = service is working = up)
    for (const requiredService of requiredServices) {
      if (!servicesWithEvents.has(requiredService)) {
        // Check if this service is in member.services (they should provide it)
        if (member.services.includes(requiredService)) {
          const defaultDomain = this.createDefaultDomain(requiredService);
          const combinationKey = `${defaultDomain}:required:no-stats`;

          if (!trackedCombinations.has(combinationKey)) {
            this.serviceStatusGauge.set(
              {
                member: member.name,
                service: requiredService,
                domain: defaultDomain,
                check_type: 'required',
                check_name: 'no-stats',
                level: member.level.toString(),
              },
              1, // Up - required service with no downtime events (service is working)
            );
            trackedCombinations.add(combinationKey);
          }
        }
      }
    }

    // For services that don't have any downtime events and are not required,
    // mark them as up if member is active
    // This ensures all member services appear in metrics
    if (member.active) {
      for (const service of member.services) {
        // Only create default entries for services that don't have any events
        // and are not required services (required services already handled above)
        if (
          !servicesWithEvents.has(service) &&
          !requiredServices.has(service)
        ) {
          const defaultDomain = this.createDefaultDomain(service);
          const combinationKey = `${defaultDomain}:default:default`;

          if (!trackedCombinations.has(combinationKey)) {
            this.serviceStatusGauge.set(
              {
                member: member.name,
                service: service,
                domain: defaultDomain,
                check_type: 'default',
                check_name: 'default',
                level: member.level.toString(),
              },
              1, // Up (no downtime events and member is active)
            );
          }
        }
      }
    }
  }

  private matchServiceFromDomain(
    domain: string,
    availableServices: string[],
  ): string {
    // Extract the domain prefix (before the first dot)
    const domainPrefix = domain.split('.')[0].toLowerCase();

    // Try to match against available services
    // First, try exact match after converting service name to domain format
    for (const service of availableServices) {
      const serviceDomain = service.toLowerCase().replace(/\s+/g, '-');
      if (
        domainPrefix.includes(serviceDomain) ||
        serviceDomain.includes(domainPrefix)
      ) {
        return service;
      }
    }

    // Try to match by converting domain prefix to service name format
    // e.g., "eth-asset-hub-polkadot" -> "ETH-Asset-Hub-Polkadot"
    const serviceName = domainPrefix
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('-');

    // Check if this matches any available service
    for (const service of availableServices) {
      if (service.toLowerCase() === serviceName.toLowerCase()) {
        return service;
      }
    }

    // If no match found, return the formatted domain prefix
    return serviceName;
  }

  private createDefaultDomain(service: string): string {
    // Convert service name to domain format
    // e.g., "Asset-Hub-Polkadot" -> "asset-hub-polkadot.ibp.network"
    return `${service.toLowerCase().replace(/\s+/g, '-')}.ibp.network`;
  }

  private mapEndpointToServiceName(endpoint: string): string {
    // Convert endpoint name to service name format
    // e.g., "kusama" -> "Kusama", "asset-hub-paseo" -> "Asset-Hub-Paseo"
    return endpoint
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('-');
  }

  private getRequiredServicesByLevel(
    level: number,
    servicesConfig: ServiceConfig,
  ): Set<string> {
    const requiredServices = new Set<string>();

    for (const [, config] of Object.entries(servicesConfig)) {
      const requiredLevel = parseInt(config.level_required, 10);
      if (level >= requiredLevel) {
        // Map endpoint names to service names
        for (const endpoint of Object.keys(config.endpoints)) {
          const serviceName = this.mapEndpointToServiceName(endpoint);
          requiredServices.add(serviceName);
        }
      }
    }

    return requiredServices;
  }

  async updateMetricsForAllMembers(): Promise<void> {
    // Reset all metrics to start fresh
    this.memberStatusGauge.reset();
    this.serviceStatusGauge.reset();
    this.downtimeEventCounter.reset();

    // Get all members
    const members = await this.apiClient.getAllMembers();

    // Process each member
    for (const member of members) {
      // Get cached or fetch member data
      let cachedData: CachedMemberData;
      try {
        cachedData = await this.getCachedOrFetchMemberData(member.name);
      } catch (error) {
        console.error(`Error fetching data for member ${member.name}:`, error);
        continue; // Skip this member if we can't fetch data
      }

      const {
        member: cachedMember,
        downtimeEvents,
        requiredServices,
      } = cachedData;

      // Update member status
      this.memberStatusGauge.set(
        {
          member: cachedMember.name,
          region: cachedMember.region,
          level: cachedMember.level.toString(),
        },
        cachedMember.active ? 1 : 0,
      );

      // Track all unique domain/check combinations we've seen for this member
      const trackedCombinations = new Set<string>();
      const servicesWithEvents = new Set<string>();

      // Process downtime events and update metrics
      for (const event of downtimeEvents) {
        // Only process events for the current member (safety check)
        if (event.member_name !== cachedMember.name) {
          continue;
        }

        const serviceName = this.matchServiceFromDomain(
          event.domain_name,
          cachedMember.services,
        );
        const combinationKey = `${event.domain_name}:${event.check_type}:${event.check_name}`;
        trackedCombinations.add(combinationKey);
        servicesWithEvents.add(serviceName);

        // Increment downtime event counter
        this.downtimeEventCounter.inc({
          member: cachedMember.name,
          service: serviceName,
          domain: event.domain_name,
          check_type: event.check_type,
          check_name: event.check_name,
          status: event.status,
        });

        // Update service status based on event status
        // If status is "ongoing", the service is down (0), otherwise it's up (1)
        const status = event.status === 'ongoing' ? 0 : 1;
        this.serviceStatusGauge.set(
          {
            member: cachedMember.name,
            service: serviceName,
            domain: event.domain_name,
            check_type: event.check_type,
            check_name: event.check_name,
            level: cachedMember.level.toString(),
          },
          status,
        );
      }

      // For required services that have no downtime events, mark as up
      // (no events = service is working = up)
      for (const requiredService of requiredServices) {
        if (!servicesWithEvents.has(requiredService)) {
          // Check if this service is in member.services (they should provide it)
          if (cachedMember.services.includes(requiredService)) {
            const defaultDomain = this.createDefaultDomain(requiredService);
            const combinationKey = `${defaultDomain}:required:no-stats`;

            if (!trackedCombinations.has(combinationKey)) {
              this.serviceStatusGauge.set(
                {
                  member: cachedMember.name,
                  service: requiredService,
                  domain: defaultDomain,
                  check_type: 'required',
                  check_name: 'no-stats',
                  level: cachedMember.level.toString(),
                },
                1, // Up - required service with no downtime events (service is working)
              );
              trackedCombinations.add(combinationKey);
            }
          }
        }
      }

      // For services that don't have any downtime events and are not required,
      // mark them as up if member is active
      // This ensures all member services appear in metrics
      if (cachedMember.active) {
        for (const service of cachedMember.services) {
          // Only create default entries for services that don't have any events
          // and are not required services (required services already handled above)
          if (
            !servicesWithEvents.has(service) &&
            !requiredServices.has(service)
          ) {
            const defaultDomain = this.createDefaultDomain(service);
            const combinationKey = `${defaultDomain}:default:default`;

            if (!trackedCombinations.has(combinationKey)) {
              this.serviceStatusGauge.set(
                {
                  member: cachedMember.name,
                  service: service,
                  domain: defaultDomain,
                  check_type: 'default',
                  check_name: 'default',
                  level: cachedMember.level.toString(),
                },
                1, // Up (no downtime events and member is active)
              );
            }
          }
        }
      }
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
