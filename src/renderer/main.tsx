import { render } from 'preact';
import { App } from './components/App.js';
import { parseReport, parseSettings } from './data.js';
import { initFilters } from './filters/store.js';
import { initTheme } from './theme.js';
import './styles.css';

const settings = parseSettings(document.getElementById('loupe-settings')?.textContent);
document.title = settings.title;
initTheme(settings.theme);

const result = parseReport(document.getElementById('loupe-data')?.textContent);
const root = document.getElementById('app') ?? document.body;
if (result.ok) initFilters(result.report);

render(
  result.ok ? (
    <App report={result.report} settings={settings} />
  ) : (
    <main class="load-error">
      <div role="alert">
        <h1>Loupe could not open this report</h1>
        <p>{result.message}</p>
      </div>
    </main>
  ),
  root,
);
