import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, PermissionDto } from '../../../core/models/dto';

@Injectable({ providedIn: 'root' })
export class AdminPermissionsService {
  private readonly http = inject(HttpClient);

  async list(): Promise<PermissionDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<PermissionDto[]>>('/api/admin/permissions'));
    return res.data;
  }
}
