import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../core/utils/http-error';
import type { JiraChecklistDto, JiraTicketDto } from '../../../core/models/dto';
import { JiraService } from '../jira.service';

@Component({
  selector: 'app-jira-ticket-detail',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './jira-ticket-detail.html',
  styleUrl: './jira-ticket-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JiraTicketDetail {
  private readonly jiraService = inject(JiraService);
  private readonly dialogRef = inject(MatDialogRef<JiraTicketDetail>);
  private readonly permissions = inject(PermissionsService);
  private readonly snackBar = inject(MatSnackBar);
  readonly ticketKey: string = inject(MAT_DIALOG_DATA);

  readonly canGenerate = this.permissions.can(Resource.Atlassian, Action.Create);
  readonly canEdit = this.permissions.can(Resource.Atlassian, Action.Update);
  readonly canDelete = this.permissions.can(Resource.Atlassian, Action.Delete);

  readonly loading = signal(true);
  readonly ticket = signal<JiraTicketDto | null>(null);
  readonly checklist = signal<JiraChecklistDto | null>(null);

  readonly editing = signal(false);
  readonly draftContent = signal('');
  readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [ticket, checklist] = await Promise.all([
        this.jiraService.getTicket(this.ticketKey),
        this.jiraService.getChecklist(this.ticketKey),
      ]);
      this.ticket.set(ticket);
      this.checklist.set(checklist);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to load ticket'), 'Dismiss', { duration: 5000 });
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  async generate(): Promise<void> {
    this.busy.set(true);
    try {
      const checklist = await this.jiraService.generateChecklist(this.ticketKey);
      this.checklist.set(checklist);
      this.editing.set(false);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to generate checklist'), 'Dismiss', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  startEdit(): void {
    this.draftContent.set(this.checklist()?.content ?? '');
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  async saveEdit(): Promise<void> {
    this.busy.set(true);
    try {
      const checklist = await this.jiraService.updateChecklist(this.ticketKey, this.draftContent());
      this.checklist.set(checklist);
      this.editing.set(false);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to save checklist'), 'Dismiss', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }

  async deleteChecklist(): Promise<void> {
    this.busy.set(true);
    try {
      await this.jiraService.deleteChecklist(this.ticketKey);
      this.checklist.set(null);
      this.editing.set(false);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to delete checklist'), 'Dismiss', { duration: 5000 });
    } finally {
      this.busy.set(false);
    }
  }
}
