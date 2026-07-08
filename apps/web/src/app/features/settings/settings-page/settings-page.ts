import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../core/utils/http-error';
import { SettingsService } from '../settings.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  private readonly settingsService = inject(SettingsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly permissions = inject(PermissionsService);

  readonly canEdit = this.permissions.can(Resource.Settings, Action.Update);

  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly timeout = signal('120');
  readonly maxFiles = signal('300');
  readonly maxDiffSize = signal('500000');
  readonly model = signal('sonnet');
  readonly autoReview = signal(false);
  readonly autoReviewStatuses = signal('OPEN');
  readonly autoReviewAuthors = signal('');
  readonly autoRerunReview = signal(false);
  readonly autoRerunReviewStatuses = signal('OPEN');
  readonly autoPostToGithub = signal(false);
  readonly autoPostSeverities = signal('critical,high,medium,low,info');
  readonly jiraEnabled = signal(false);
  readonly jiraTicketPattern = signal('[A-Z][A-Z0-9]+-\\d+');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const settings = await this.settingsService.getAll();
      this.timeout.set(settings['ai.review.timeout'] ?? '120');
      this.maxFiles.set(settings['ai.review.maxFiles'] ?? '300');
      this.maxDiffSize.set(settings['ai.review.maxDiffSize'] ?? '500000');
      this.model.set(settings['ai.review.model'] ?? 'sonnet');
      this.autoReview.set(settings['ai.review.autoReview'] === '1');
      this.autoReviewStatuses.set(settings['ai.review.autoReviewStatuses'] ?? 'OPEN');
      this.autoReviewAuthors.set(settings['ai.review.autoReviewAuthors'] ?? '');
      this.autoRerunReview.set(settings['ai.review.autoRerunReview'] === '1');
      this.autoRerunReviewStatuses.set(settings['ai.review.autoRerunReviewStatuses'] ?? 'OPEN');
      this.autoPostToGithub.set(settings['ai.review.autoPostToGithub'] === '1');
      this.autoPostSeverities.set(settings['ai.review.autoPostSeverities'] ?? 'critical,high,medium,low,info');
      this.jiraEnabled.set(settings['ai.review.jiraEnabled'] === '1');
      this.jiraTicketPattern.set(settings['ai.review.jiraTicketPattern'] ?? '[A-Z][A-Z0-9]+-\\d+');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      // The backend's bulk-update schema requires non-empty strings (z.string().min(1)) —
      // omit empty fields (e.g. an intentionally-empty author whitelist) rather than send "".
      const values: Record<string, string> = {
        'ai.review.timeout': this.timeout(),
        'ai.review.maxFiles': this.maxFiles(),
        'ai.review.maxDiffSize': this.maxDiffSize(),
        'ai.review.model': this.model(),
        'ai.review.autoReview': this.autoReview() ? '1' : '0',
        'ai.review.autoReviewStatuses': this.autoReviewStatuses(),
        'ai.review.autoReviewAuthors': this.autoReviewAuthors(),
        'ai.review.autoRerunReview': this.autoRerunReview() ? '1' : '0',
        'ai.review.autoRerunReviewStatuses': this.autoRerunReviewStatuses(),
        'ai.review.autoPostToGithub': this.autoPostToGithub() ? '1' : '0',
        'ai.review.autoPostSeverities': this.autoPostSeverities(),
        'ai.review.jiraEnabled': this.jiraEnabled() ? '1' : '0',
        'ai.review.jiraTicketPattern': this.jiraTicketPattern(),
      };
      for (const key of Object.keys(values)) {
        if (values[key] === '') delete values[key];
      }
      await this.settingsService.update(values);
      this.snackBar.open('Settings saved', 'Dismiss', { duration: 3000 });
    } catch (err) {
      this.snackBar.open(extractErrorMessage(err, 'Failed to save settings'), 'Dismiss', { duration: 5000 });
    } finally {
      this.saving.set(false);
    }
  }
}
