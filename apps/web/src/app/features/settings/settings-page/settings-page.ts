import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Action, Resource } from '../../../core/models/enums';
import { PermissionsService } from '../../../core/services/permissions.service';
import { extractErrorMessage } from '../../../core/utils/http-error';
import { CommandTemplateEditor } from '../command-template-editor/command-template-editor';
import { DEFAULT_SYSTEM_TEMPLATE, DEFAULT_USER_TEMPLATE, TEMPLATE_VARIABLES } from '../prompt-template-defaults';
import { SettingsService } from '../settings.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [
    CommandTemplateEditor,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTabsModule,
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

  readonly templateVariables = TEMPLATE_VARIABLES;
  readonly defaultUserTemplate = DEFAULT_USER_TEMPLATE;
  readonly defaultSystemTemplate = DEFAULT_SYSTEM_TEMPLATE;

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
  readonly promptTemplate = signal(DEFAULT_USER_TEMPLATE);
  readonly systemPromptTemplate = signal(DEFAULT_SYSTEM_TEMPLATE);
  readonly jiraEnabled = signal(false);
  readonly jiraTicketPattern = signal('[A-Z][A-Z0-9]+-\\d+');
  readonly checklistPromptTemplate = signal('');

  readonly googleChatEnabled = signal(false);
  readonly googleChatWebhook = signal('');
  readonly googleChatTemplate = signal('');
  readonly googleChatMergedPrTemplate = signal('');
  readonly googleChatReminderTemplate = signal('');
  readonly sprintReminderEnabled = signal(false);
  readonly reminderDaysRemaining = signal('3');
  readonly reminderTimeHour = signal('13');
  readonly reminderTimeMinute = signal('30');
  readonly sprintStartDate = signal('2026-01-05');
  readonly sprintLengthDays = signal('14');

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
      this.promptTemplate.set(settings['ai.review.promptTemplate'] || DEFAULT_USER_TEMPLATE);
      this.systemPromptTemplate.set(settings['ai.review.systemPromptTemplate'] || DEFAULT_SYSTEM_TEMPLATE);
      this.jiraEnabled.set(settings['ai.review.jiraEnabled'] === '1');
      this.jiraTicketPattern.set(settings['ai.review.jiraTicketPattern'] ?? '[A-Z][A-Z0-9]+-\\d+');
      this.checklistPromptTemplate.set(settings['ai.review.checklistPromptTemplate'] ?? '');
      this.googleChatEnabled.set(settings['ai.review.googleChatEnabled'] === '1');
      this.googleChatWebhook.set(settings['ai.review.googleChatWebhook'] ?? '');
      this.googleChatTemplate.set(settings['ai.review.googleChatTemplate'] ?? '');
      this.googleChatMergedPrTemplate.set(settings['ai.review.googleChatMergedPrTemplate'] ?? '');
      this.googleChatReminderTemplate.set(settings['ai.review.googleChatReminderTemplate'] ?? '');
      this.sprintReminderEnabled.set(settings['ai.review.sprintReminderEnabled'] === '1');
      this.reminderDaysRemaining.set(settings['ai.review.reminderDaysRemaining'] ?? '3');
      this.reminderTimeHour.set(settings['ai.review.reminderTimeHour'] ?? '13');
      this.reminderTimeMinute.set(settings['ai.review.reminderTimeMinute'] ?? '30');
      this.sprintStartDate.set(settings['report.sprintStartDate'] ?? '2026-01-05');
      this.sprintLengthDays.set(settings['report.sprintLengthDays'] ?? '14');
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
        'ai.review.promptTemplate': this.promptTemplate(),
        'ai.review.systemPromptTemplate': this.systemPromptTemplate(),
        'ai.review.jiraEnabled': this.jiraEnabled() ? '1' : '0',
        'ai.review.jiraTicketPattern': this.jiraTicketPattern(),
        'ai.review.checklistPromptTemplate': this.checklistPromptTemplate(),
        'ai.review.googleChatEnabled': this.googleChatEnabled() ? '1' : '0',
        'ai.review.googleChatWebhook': this.googleChatWebhook(),
        'ai.review.googleChatTemplate': this.googleChatTemplate(),
        'ai.review.googleChatMergedPrTemplate': this.googleChatMergedPrTemplate(),
        'ai.review.googleChatReminderTemplate': this.googleChatReminderTemplate(),
        'ai.review.sprintReminderEnabled': this.sprintReminderEnabled() ? '1' : '0',
        'ai.review.reminderDaysRemaining': this.reminderDaysRemaining(),
        'ai.review.reminderTimeHour': this.reminderTimeHour(),
        'ai.review.reminderTimeMinute': this.reminderTimeMinute(),
        'report.sprintStartDate': this.sprintStartDate(),
        'report.sprintLengthDays': this.sprintLengthDays(),
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
