import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SetupProgressComponent } from '../../shared/setup-progress/setup-progress';

@Component({
  selector: 'app-home',
  imports: [RouterLink, SetupProgressComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {}
