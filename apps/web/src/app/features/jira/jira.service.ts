import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, JiraChecklistDto, JiraTicketDto } from '../../core/models/dto';

export interface SearchTicketsFilter {
  jql?: string;
  projectKey?: string;
  key?: string;
}

@Injectable({ providedIn: 'root' })
export class JiraService {
  private readonly http = inject(HttpClient);

  async searchTickets(filter: SearchTicketsFilter): Promise<JiraTicketDto[]> {
    const params = new URLSearchParams();
    if (filter.jql) params.set('jql', filter.jql);
    if (filter.projectKey) params.set('projectKey', filter.projectKey);
    if (filter.key) params.set('key', filter.key);
    const res = await firstValueFrom(this.http.get<ApiResponse<JiraTicketDto[]>>(`/api/jira/tickets?${params}`));
    return res.data;
  }

  async getTicket(key: string): Promise<JiraTicketDto> {
    const res = await firstValueFrom(this.http.get<ApiResponse<JiraTicketDto>>(`/api/jira/tickets/${key}`));
    return res.data;
  }

  async getChecklist(ticketKey: string): Promise<JiraChecklistDto | null> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<JiraChecklistDto>>(`/api/jira/checklists/${ticketKey}`));
      return res.data;
    } catch {
      return null;
    }
  }

  async generateChecklist(ticketKey: string): Promise<JiraChecklistDto> {
    const res = await firstValueFrom(this.http.post<ApiResponse<JiraChecklistDto>>(`/api/jira/checklists/${ticketKey}/generate`, {}));
    return res.data;
  }

  async updateChecklist(ticketKey: string, content: string): Promise<JiraChecklistDto> {
    const res = await firstValueFrom(this.http.put<ApiResponse<JiraChecklistDto>>(`/api/jira/checklists/${ticketKey}`, { content }));
    return res.data;
  }

  async deleteChecklist(ticketKey: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/jira/checklists/${ticketKey}`));
  }
}
