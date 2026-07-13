import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminGroupDto, ApiResponse } from '../../../core/models/dto';

export interface GroupFormInput {
  name: string;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminGroupsService {
  private readonly http = inject(HttpClient);

  async list(): Promise<AdminGroupDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AdminGroupDto[]>>('/api/admin/groups'));
    return res.data;
  }

  async create(input: GroupFormInput): Promise<void> {
    await firstValueFrom(this.http.post('/api/admin/groups', input));
  }

  async update(id: string, input: GroupFormInput): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/admin/groups/${id}`, input));
  }

  async remove(id: string, force = false): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/groups/${id}${force ? '?force=true' : ''}`));
  }

  async setRoles(id: string, roleIds: string[]): Promise<void> {
    await firstValueFrom(this.http.put(`/api/admin/groups/${id}/roles`, { roleIds }));
  }
}
