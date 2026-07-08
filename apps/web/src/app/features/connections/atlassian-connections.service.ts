import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, AtlassianConnectionDto, AtlassianConnectionTestResult } from '../../core/models/dto';

export interface ReplaceAtlassianConnectionInput {
  hostname: string;
  email: string;
  apiToken: string;
}

@Injectable({ providedIn: 'root' })
export class AtlassianConnectionsService {
  private readonly http = inject(HttpClient);

  async get(): Promise<AtlassianConnectionDto | null> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AtlassianConnectionDto | null>>('/api/atlassian/connection'));
    return res.data;
  }

  async replace(input: ReplaceAtlassianConnectionInput): Promise<AtlassianConnectionDto> {
    const res = await firstValueFrom(this.http.put<ApiResponse<AtlassianConnectionDto>>('/api/atlassian/connection', input));
    return res.data;
  }

  async remove(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/atlassian/connection'));
  }

  async test(): Promise<AtlassianConnectionTestResult> {
    const res = await firstValueFrom(this.http.post<ApiResponse<AtlassianConnectionTestResult>>('/api/atlassian/connection/test', {}));
    return res.data;
  }

  async testTicket(ticketKey: string): Promise<unknown> {
    const res = await firstValueFrom(this.http.post<ApiResponse<unknown>>('/api/atlassian/connection/test-ticket', { ticketKey }));
    return res.data;
  }
}
