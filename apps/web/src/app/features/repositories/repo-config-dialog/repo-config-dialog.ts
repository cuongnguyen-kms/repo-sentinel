import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import type { WatchedRepoDto } from '../../../core/models/dto';
import { CommandTemplateEditor } from '../../settings/command-template-editor/command-template-editor';
import { DEFAULT_SYSTEM_TEMPLATE, DEFAULT_USER_TEMPLATE, TEMPLATE_VARIABLES } from '../../settings/prompt-template-defaults';
import { ReposService } from '../repos.service';

@Component({
  selector: 'app-repo-config-dialog',
  standalone: true,
  imports: [
    CommandTemplateEditor,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    TranslocoModule,
  ],
  templateUrl: './repo-config-dialog.html',
  styleUrl: './repo-config-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoConfigDialog {
  private readonly reposService = inject(ReposService);
  private readonly dialogRef = inject(MatDialogRef<RepoConfigDialog>);
  private readonly transloco = inject(TranslocoService);
  readonly repo: WatchedRepoDto = inject(MAT_DIALOG_DATA);

  readonly templateVariables = TEMPLATE_VARIABLES;
  readonly defaultUserTemplate = DEFAULT_USER_TEMPLATE;
  readonly defaultSystemTemplate = DEFAULT_SYSTEM_TEMPLATE;

  readonly pollingInterval = signal(this.repo.pollingInterval);
  readonly isActive = signal(this.repo.isActive);

  readonly useCustomPrompt = signal(this.repo.promptTemplate !== null);
  readonly promptTemplate = signal(this.repo.promptTemplate ?? DEFAULT_USER_TEMPLATE);
  readonly useCustomSystemPrompt = signal(this.repo.systemPromptTemplate !== null);
  readonly systemPromptTemplate = signal(this.repo.systemPromptTemplate ?? DEFAULT_SYSTEM_TEMPLATE);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  cancel(): void {
    this.dialogRef.close();
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const updated = await this.reposService.updateConfig(this.repo.id, {
        pollingInterval: this.pollingInterval(),
        isActive: this.isActive(),
        promptTemplate: this.useCustomPrompt() ? this.promptTemplate() : null,
        systemPromptTemplate: this.useCustomSystemPrompt() ? this.systemPromptTemplate() : null,
      });
      this.dialogRef.close(updated);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : this.transloco.translate('repositories.configDialog.updateFailed'));
    } finally {
      this.saving.set(false);
    }
  }
}
