import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  // Eagerly instantiate so the saved theme preference applies before any page renders,
  // including /login (which sits outside the guarded shell where TopBar lives).
  private readonly themeService = inject(ThemeService);
}
