import { lazy } from 'react';
import { BusyNotice, Header } from './sharedUi';

const Imports = lazy(() => import('./ImportsView'));
const Parts = lazy(() => import('./PartsView'));
const Projects = lazy(() => import('./ProjectsView'));
const Search = lazy(() => import('./SearchView'));
const Settings = lazy(() => import('./SettingsView'));

export {
  BusyNotice,
  Header,
  Imports,
  Parts,
  Projects,
  Search,
  Settings,
};
