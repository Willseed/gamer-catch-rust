import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'GamerCatch｜巴哈排行與人氣自動整理',
    loadComponent: () => import('./pages/home/home').then((module) => module.HomePage),
  },
  {
    path: 'generator',
    title: '設定檔產生器｜GamerCatch',
    loadComponent: () =>
      import('./pages/generator/generator').then((module) => module.GeneratorPage),
  },
  {
    path: 'guide',
    title: '完整操作教學｜GamerCatch',
    loadComponent: () => import('./pages/guide/guide').then((module) => module.GuidePage),
  },
  {
    path: 'downloads',
    title: '下載｜GamerCatch',
    loadComponent: () =>
      import('./pages/downloads/downloads').then((module) => module.DownloadsPage),
  },
  { path: '**', redirectTo: '' },
];
