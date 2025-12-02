import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface Member {
  name: string;
  website: string;
  logo: string;
  level: number;
  joined_date: string;
  region: string;
  latitude: number;
  longitude: number;
  service_ipv4?: string;
  service_ipv6?: string;
  services: string[];
  active: boolean;
  override: boolean;
}

export interface DowntimeEvent {
  id: number;
  member_name: string;
  check_type: string;
  check_name: string;
  domain_name: string;
  endpoint: string;
  start_time: string;
  duration: string;
  error: string;
  is_ipv6: boolean;
  status: string;
}

@Injectable()
export class ApiClientService {
  private readonly apiBaseUrl = 'https://ibdash.dotters.network:9000/api';
  private readonly axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: 10000,
    });
  }

  async getAllMembers(): Promise<Member[]> {
    const response = await this.axiosInstance.get<Member[]>('/members');
    return response.data;
  }

  async getMemberByName(memberName: string): Promise<Member | null> {
    const members = await this.getAllMembers();
    return members.find((m) => m.name === memberName) || null;
  }

  async getDowntimeEvents(
    memberName: string,
    startDate: string,
    endDate: string,
  ): Promise<DowntimeEvent[]> {
    const response = await this.axiosInstance.get<DowntimeEvent[]>(
      '/downtime/events',
      {
        params: {
          member: memberName,
          start: startDate,
          end: endDate,
        },
      },
    );
    return response.data;
  }
}
