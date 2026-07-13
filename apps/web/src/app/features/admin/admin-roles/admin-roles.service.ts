import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminRoleDto, ApiResponse } from '../../../core/models/dto';

export interface RoleFormInput {
  name: string;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminRolesService {
  private readonly http = inject(HttpClient);

  async list(): Promise<AdminRoleDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AdminRoleDto[]>>('/api/admin/roles'));
    return res.data;
  }

  async create(input: RoleFormInput): Promise<void> {
    await firstValueFrom(this.http.post('/api/admin/roles', input));
  }

  async update(id: string, input: RoleFormInput): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/admin/roles/${id}`, input));
  }

  async remove(id: string, force = false): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/roles/${id}${force ? '?force=true' : ''}`));
  }

  async setPermissions(id: string, permissionIds: string[]): Promise<void> {
    await firstValueFrom(this.http.put(`/api/admin/roles/${id}/permissions`, { permissionIds }));
  }
}
