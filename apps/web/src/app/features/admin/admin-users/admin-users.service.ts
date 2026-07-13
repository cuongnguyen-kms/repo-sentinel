import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminUserDto, ApiResponse, CreateAdminUserInput, UpdateAdminUserInput } from '../../../core/models/dto';

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly http = inject(HttpClient);

  async list(): Promise<AdminUserDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AdminUserDto[]>>('/api/admin/users'));
    return res.data;
  }

  async create(input: CreateAdminUserInput): Promise<void> {
    await firstValueFrom(this.http.post('/api/admin/users', input));
  }

  async update(id: string, input: UpdateAdminUserInput): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/admin/users/${id}`, input));
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/users/${id}`));
  }

  async setGroups(id: string, groupIds: string[]): Promise<void> {
    await firstValueFrom(this.http.put(`/api/admin/users/${id}/groups`, { groupIds }));
  }
}
