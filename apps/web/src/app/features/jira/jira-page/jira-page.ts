import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { extractErrorMessage } from '../../../core/utils/http-error';
import type { JiraTicketDto } from '../../../core/models/dto';
import { JiraService } from '../jira.service';
import { JiraTicketDetail } from '../jira-ticket-detail/jira-ticket-detail';

@Component({
  selector: 'app-jira-page',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './jira-page.html',
  styleUrl: './jira-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JiraPage {
  private readonly jiraService = inject(JiraService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly jql = signal('');
  readonly projectKey = signal('');
  readonly key = signal('');

  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly tickets = signal<JiraTicketDto[]>([]);

  readonly columns = ['key', 'summary', 'status'];

  async search(): Promise<void> {
    this.loading.set(true);
    try {
      const results = await this.jiraService.searchTickets({
        jql: this.jql().trim() || undefined,
        projectKey: this.projectKey().trim() || undefined,
        key: this.key().trim() || undefined,
      });
      this.tickets.set(results);
      this.searched.set(true);
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to search tickets'), 'Dismiss', { duration: 5000 });
    } finally {
      this.loading.set(false);
    }
  }

  openTicket(ticket: JiraTicketDto): void {
    this.dialog.open(JiraTicketDetail, { width: '640px', data: ticket.key });
  }
}
