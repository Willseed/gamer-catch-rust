import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  provideRouter,
  type InMemoryScrollingOptions,
  withInMemoryScrolling,
} from '@angular/router';

import { routes } from './app.routes';

export const routerScrollingOptions: InMemoryScrollingOptions = {
  anchorScrolling: 'disabled',
  scrollPositionRestoration: 'disabled',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideRouter(routes, withInMemoryScrolling(routerScrollingOptions)),
  ],
};
