import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import type { TemplateVariable } from '../prompt-template-defaults';

/** Replace {{key}}/{key} placeholders with sample values, for the preview panel only. */
function interpolateSample(template: string, variables: TemplateVariable[]): string {
  let result = template;
  for (const v of variables) {
    const key = v.name.replace(/[{}]/g, '');
    result = result.replaceAll(`{{${key}}}`, v.example).replaceAll(`{${key}}`, v.example);
  }
  return result;
}

@Component({
  selector: 'app-command-template-editor',
  standalone: true,
  imports: [FormsModule, MatButtonModule],
  templateUrl: './command-template-editor.html',
  styleUrl: './command-template-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandTemplateEditor {
  readonly value = model.required<string>();
  readonly defaultValue = input('');
  readonly variables = input<TemplateVariable[]>([]);
  readonly disabled = input(false);
  readonly rows = input(12);

  readonly showPreview = signal(false);

  private readonly textareaEl = viewChild<ElementRef<HTMLTextAreaElement>>('textareaEl');

  readonly previewText = computed(() => interpolateSample(this.value(), this.variables()));

  resetToDefault(): void {
    this.value.set(this.defaultValue());
  }

  togglePreview(): void {
    this.showPreview.update((v) => !v);
  }

  /** Insert a variable token at the current cursor position (or append if unfocused). */
  insertVariable(variable: string): void {
    const el = this.textareaEl()?.nativeElement;
    const current = this.value();
    if (!el) {
      this.value.set(current + variable);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    this.value.set(current.slice(0, start) + variable + current.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + variable.length;
      el.setSelectionRange(cursor, cursor);
    });
  }
}
